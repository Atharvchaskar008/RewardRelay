import "server-only";
import { getAddress, zeroHash, type Address } from "viem";
import {
  CATEGORY_LABELS,
  DealStatus,
  STATUS_LABELS,
  STATUS_NAMES,
  categoryById,
  categoryByKey,
  findBlockedTopic,
  inrToWei,
  type CategoryKey,
} from "@rewardrelay/shared";
import { listingTermsHash } from "@/common/terms";
import { afterResponse } from "../background";
import { explorerAddressUrl, mapLimit, readDeals, readTrust, type OnChainDeal } from "../chain";
import { serverEnv } from "../env";
import { AppError } from "../errors";
import { errorFields, log } from "../log";
import { requireLinkedUser } from "../identity/users";
import { repos, type ListingDoc } from "../repositories";
import { runQuery, transaction } from "../repositories/collection";
import { withDeadline } from "../deadline";
import { syncDealIndex } from "../deals/dealIndex";
import { readDealOrThrow } from "../deals/read";
import { TIER_NAMES, money, type Money } from "../views/user";

const mismatch = (message: string, details?: Record<string, unknown>) =>
  new AppError("CHAIN_STATE_MISMATCH", { message, details });

// ---------------------------------------------------------------------------------------------
// Listing metadata, accepted only when it matches the on-chain listing
// ---------------------------------------------------------------------------------------------

export interface ListingInput {
  dealId: string;
  title: string;
  description: string;
  category: string;
  faceValueInr: number;
  priceInr: number;
  eventTime?: number | null;
  terms: Record<string, unknown>;
}

export async function registerListing(uid: string, input: ListingInput): Promise<ListingView> {
  const user = await requireLinkedUser(uid);
  const category = categoryByKey(input.category);
  if (!category) throw new AppError("VALIDATION_FAILED", { message: "Unknown category." });
  const blocked = findBlockedTopic(input.title, input.description, JSON.stringify(input.terms));
  if (blocked) {
    throw new AppError("VALIDATION_FAILED", {
      message: `SAKAR does not allow: ${blocked.label}.`,
      details: { blockedTopic: blocked.key },
    });
  }
  if (input.faceValueInr > 0 && input.priceInr > input.faceValueInr) {
    throw new AppError("VALIDATION_FAILED", { message: "The price cannot exceed the face value." });
  }

  const id = BigInt(input.dealId);
  const deal = await readDealOrThrow(id);
  if (deal.status !== DealStatus.Listed) {
    throw mismatch("This deal is no longer open on-chain.", {
      status: STATUS_NAMES[deal.status as DealStatus],
    });
  }
  if (getAddress(deal.sharer) !== user.address) {
    throw new AppError("FORBIDDEN", {
      message: "Only the sharer who created this deal can publish it.",
    });
  }
  if (deal.category !== category.id)
    throw mismatch("The category does not match the on-chain deal.");
  const eventTime = input.eventTime ?? 0;
  if (BigInt(eventTime) !== deal.eventTime)
    throw mismatch("The event time does not match the on-chain deal.");

  const expectedWei = inrToWei(input.priceInr, serverEnv().DEMO_RATE_INR_PER_MSTC);
  const diff = expectedWei > deal.price ? expectedWei - deal.price : deal.price - expectedWei;
  if (diff > 1n) {
    throw mismatch("The ₹ price does not match the on-chain price at the demo rate.", {
      expectedWei: expectedWei.toString(),
      onChainWei: deal.price.toString(),
    });
  }

  const termsHash = listingTermsHash({
    title: input.title,
    description: input.description,
    category: category.key,
    faceValueInr: input.faceValueInr,
    priceInr: input.priceInr,
    eventTime,
    conditions: input.terms,
  });
  if (termsHash !== deal.termsHash)
    throw mismatch("The listing terms do not match the on-chain terms hash.");

  const dealId = id.toString();
  const now = Date.now();
  const doc: ListingDoc = {
    dealId,
    sharer: user.address,
    dealType: category.dealType,
    category: category.key,
    categoryId: category.id,
    title: input.title,
    description: input.description,
    faceValueInr: input.faceValueInr,
    priceInr: input.priceInr,
    priceWei: deal.price.toString(),
    eventTime: eventTime > 0 ? eventTime * 1000 : null,
    terms: input.terms,
    termsHash,
    status: STATUS_NAMES[DealStatus.Listed],
    releaseAt: null,
    createdAt: now,
    updatedAt: now,
  };

  await transaction(async (tx) => {
    if (await repos.listings.get(dealId, tx)) {
      throw new AppError("CONFLICT", { message: "This deal is already published." });
    }
    const fingerprint = deal.codeFingerprint;
    const vault = fingerprint !== zeroHash ? await repos.vault.get(fingerprint, tx) : undefined;
    if (category.dealType === "PassOn") {
      if (!vault || vault.sharerUid !== uid || vault.status !== "pending") {
        throw mismatch("The code for this deal was not authorised through SAKAR.");
      }
      await repos.vault.update(fingerprint, { status: "listed", dealId }, tx);
    }
    await repos.listings.create(dealId, doc, tx);
    await repos.deals.create(
      dealId,
      {
        dealId,
        sharerUid: uid,
        seekerUid: null,
        dealType: category.dealType,
        status: doc.status,
        releaseAt: null,
        terminalAt: null,
        piiPurgedAt: null,
        updatedAt: now,
      },
      tx,
    );
  });

  const trust = await readTrust(user.address, { fresh: true });
  return listingView(doc, DealStatus.Listed, trust);
}

// ---------------------------------------------------------------------------------------------
// Public listings feed
// ---------------------------------------------------------------------------------------------

export interface ListingView {
  dealId: string;
  title: string;
  description: string;
  category: string;
  categoryLabel: string;
  dealType: "BuyForYou" | "PassOn";
  faceValueInr: number;
  priceInr: number;
  price: Money;
  status: string;
  statusLabel: string;
  sharer: Address;
  sharerTrust: { tier: number; tierName: string; completed: number; disputesLost: number };
  eventTime: string | null;
  createdAt: string;
  mstscanUrl: string;
}

function listingView(
  doc: ListingDoc,
  status: DealStatus,
  trust: { tier: number; completed: number; disputesLost: number },
): ListingView {
  return {
    dealId: doc.dealId,
    title: doc.title,
    description: doc.description,
    category: doc.category,
    categoryLabel: CATEGORY_LABELS[doc.category as CategoryKey] ?? doc.category,
    dealType: doc.dealType,
    faceValueInr: doc.faceValueInr,
    priceInr: doc.priceInr,
    price: money(BigInt(doc.priceWei)),
    status: STATUS_NAMES[status],
    statusLabel: STATUS_LABELS[status],
    sharer: getAddress(doc.sharer),
    sharerTrust: {
      tier: trust.tier,
      tierName: TIER_NAMES[trust.tier] ?? `Tier ${trust.tier}`,
      completed: trust.completed,
      disputesLost: trust.disputesLost,
    },
    eventTime: doc.eventTime ? new Date(doc.eventTime).toISOString() : null,
    createdAt: new Date(doc.createdAt).toISOString(),
    mstscanUrl: explorerAddressUrl(getAddress(doc.sharer)),
  };
}

export const PAGE_SIZE = 20;

export async function listListings(query: {
  category?: string;
  cursor?: string;
  status: "open" | "all";
}): Promise<{ items: ListingView[]; nextCursor: string | null }> {
  if (query.category && !categoryByKey(query.category)) {
    throw new AppError("VALIDATION_FAILED", { message: "Unknown category." });
  }
  let firestoreQuery = repos.listings.query().orderBy("createdAt", "desc").limit(PAGE_SIZE);
  if (query.category) firestoreQuery = firestoreQuery.where("category", "==", query.category);
  if (query.status === "open")
    firestoreQuery = firestoreQuery.where("status", "==", STATUS_NAMES[DealStatus.Listed]);
  if (query.cursor) {
    const cursorDoc = await withDeadline(
      repos.listings.ref(query.cursor).get(),
      undefined,
      "firestore.get listing cursor",
    );
    if (!cursorDoc.exists) throw new AppError("VALIDATION_FAILED", { message: "Invalid cursor." });
    firestoreQuery = firestoreQuery.startAfter(cursorDoc);
  }
  const snapshot = await runQuery(firestoreQuery, "firestore.query listings");
  const docs = snapshot.docs.map((doc) => doc.data());

  // The chain decides the status; Firestore's cached value only narrows the query.
  const deals = await readDeals(docs.map((doc) => BigInt(doc.dealId)));
  const sharers = [...new Set(docs.map((doc) => getAddress(doc.sharer)))];
  const trusts = new Map<Address, Awaited<ReturnType<typeof readTrust>>>();
  await mapLimit(sharers, 8, async (sharer) => {
    // A Sharer whose badge cannot be read right now is left out of this page instead of failing it
    // (like a deal the chain did not return).
    const trust = await readTrust(sharer).catch((error: unknown) => {
      log("warn", "listings.trust_failed", { sharer, ...errorFields(error) });
      return null;
    });
    if (trust) trusts.set(sharer, trust);
  });

  const items: ListingView[] = [];
  const toSync: [string, OnChainDeal][] = [];
  docs.forEach((doc, index) => {
    const deal = deals[index];
    const trust = trusts.get(getAddress(doc.sharer));
    if (!deal) return;
    toSync.push([doc.dealId, deal]);
    if (!trust || (query.status === "open" && deal.status !== DealStatus.Listed)) return;
    items[index] = listingView(doc, deal.status as DealStatus, trust);
  });
  // Keeping the index in step with the chain does not need to delay the feed.
  await afterResponse("listings.sync_index", () =>
    mapLimit(toSync, 8, ([dealId, deal]) => syncDealIndex(dealId, deal)),
  );

  const nextCursor = docs.length === PAGE_SIZE ? docs[docs.length - 1].dealId : null;
  return { items: items.filter(Boolean), nextCursor };
}

/** Listing category label helper for other views. */
export function categoryLabelById(id: number): string {
  const category = categoryById(id);
  return category ? CATEGORY_LABELS[category.key as CategoryKey] : `Category ${id}`;
}
