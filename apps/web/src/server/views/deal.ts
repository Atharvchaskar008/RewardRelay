import "server-only";
import { getAddress, zeroAddress, type Address, type Hash, type Hex } from "viem";
import {
  STATUS_LABELS,
  STATUS_NAMES,
  CATEGORY_LABELS,
  categoryById,
  computeNextAction,
  type AcceptBlock,
  type ActionReason,
  type CategoryKey,
  type DealRole,
  type DealStatus,
  type NextAction,
  type SecondaryAction,
} from "@rewardrelay/shared";
import {
  escrowContract,
  explorerAddressUrl,
  explorerTxUrl,
  readDealEvents,
  readTrust,
  type DealEvent,
  type OnChainDeal,
  type TrustSummary,
} from "../chain";
import { errorFields, log } from "../log";
import { repos, type ListingDoc } from "../repositories";
import { chainNow, readDealOrThrow } from "../deals/read";
import { TIER_NAMES, money, type Money } from "./user";

/** The deal room's view model: everything the UI needs, with no blockchain logic left to do. */

export interface TrustView {
  address: Address;
  hasBadge: boolean;
  tier: number;
  tierName: string;
  completed: number;
  disputesLost: number;
  mstscanUrl: string;
}

export interface TimelineEntry {
  event: string;
  label: string;
  at: string;
  txHash: Hash;
  url: string;
}

export interface DealView {
  id: string;
  type: "BuyForYou" | "PassOn";
  category: string;
  categoryLabel: string;
  status: string;
  statusLabel: string;
  role: DealRole;
  nextAction: NextAction;
  secondaryActions: SecondaryAction[];
  actionReason: ActionReason | null;
  price: Money;
  priceMstc: string;
  priceInr: number;
  /** The caller's own deposit (the sharer's for visitors). */
  deposit: Money;
  depositMstc: string;
  deposits: { sharer: Money; seeker: Money };
  /** What a visitor pays on PAY: price + seeker deposit. */
  payAmount: Money;
  feeBps: number;
  deadlines: {
    deliverBy: string | null;
    releaseAt: string | null;
    eventTime: string | null;
    evidenceUntil: string | null;
    defaultRulingAt: string | null;
  };
  sharer: Address;
  seeker: Address | null;
  counterpartTrust: TrustView | null;
  listing: Pick<ListingDoc, "title" | "description" | "faceValueInr" | "priceInr" | "terms"> | null;
  hashes: { termsHash: Hex; codeFingerprint: Hex; proofHash: Hex };
  mstscanUrls: { escrow: string; sharer: string; seeker: string | null };
  timeline: TimelineEntry[];
  chainTime: string;
}

const TIMELINE_LABELS: Record<string, (args: Record<string, unknown>) => string> = {
  ListingCreated: () => "Listed",
  ListingCancelled: () => "Cancelled by the sharer",
  DealLocked: () => "Paid, MSTC locked in escrow",
  Delivered: (args) =>
    args.proofHash === `0x${"0".repeat(64)}`
      ? "Code sealed for the seeker"
      : "Order proof submitted",
  Completed: (args) =>
    args.confirmedBySeeker ? "Confirmed by the seeker" : "Released automatically",
  Refunded: () => "Refunded after the delivery deadline",
  DisputeRaised: () => "Dispute raised",
  EvidenceAdded: () => "Evidence added",
  DisputeResolved: (args) =>
    args.arbiter === zeroAddress ? "Default 50/50 ruling" : "Resolved by the arbiter",
  PayoutDeferred: () => "Payout moved to withdrawable balance",
};

const iso = (seconds: bigint | number) =>
  Number(seconds) > 0 ? new Date(Number(seconds) * 1000).toISOString() : null;

function trustView(address: Address, trust: TrustSummary): TrustView {
  return {
    address,
    hasBadge: trust.hasBadge,
    tier: trust.tier,
    tierName: TIER_NAMES[trust.tier] ?? `Tier ${trust.tier}`,
    completed: trust.completed,
    disputesLost: trust.disputesLost,
    mstscanUrl: explorerAddressUrl(address),
  };
}

export function roleOf(deal: OnChainDeal, wallet: Address | null): DealRole {
  if (wallet && getAddress(deal.sharer) === wallet) return "sharer";
  if (wallet && deal.seeker !== zeroAddress && getAddress(deal.seeker) === wallet) return "seeker";
  return "visitor";
}

async function acceptBlockFor(
  deal: OnChainDeal,
  viewer: { uid: string; wallet: Address | null } | null,
): Promise<AcceptBlock | null> {
  if (!viewer) return "SIGN_IN";
  if (!viewer.wallet) return "NO_WALLET";
  const [trust, paused] = await Promise.all([
    readTrust(viewer.wallet),
    escrowContract().read.paused(),
  ]);
  if (paused) return "PAUSED";
  if (!trust.hasBadge) return "NO_BADGE";
  if (deal.price > trust.maxDealValue) return "OVER_LIMIT";
  return null;
}

export async function buildDealView(
  id: bigint,
  viewer: { uid: string; wallet: Address | null } | null,
  preloaded?: OnChainDeal,
): Promise<DealView> {
  const deal = preloaded ?? (await readDealOrThrow(id));
  const role = roleOf(deal, viewer?.wallet ?? null);
  const hasSeeker = deal.seeker !== zeroAddress;
  const counterpart =
    role === "sharer" ? (hasSeeker ? getAddress(deal.seeker) : null) : getAddress(deal.sharer);

  const [now, listing, counterpartTrust, acceptBlock, events] = await Promise.all([
    chainNow(),
    repos.listings.get(id.toString()),
    counterpart ? readTrust(counterpart) : Promise.resolve(null),
    role === "visitor" && deal.status === 0 ? acceptBlockFor(deal, viewer) : Promise.resolve(null),
    readDealEvents(id).catch((error): DealEvent[] => {
      log("warn", "deals.timeline_failed", { dealId: id.toString(), ...errorFields(error) });
      return [];
    }),
  ]);

  const action = computeNextAction({
    status: deal.status as DealStatus,
    role,
    now,
    deliverBy: Number(deal.deliverBy),
    releaseAt: Number(deal.releaseAt),
    eventTime: Number(deal.eventTime),
    disputeOpenedAt: Number(deal.disputeOpenedAt),
    disputeWindow: Number(deal.policy.disputeWindow),
    arbiterTimeout: Number(deal.arbiterTimeout),
    acceptBlock,
  });

  const category = categoryById(deal.category);
  const price = money(deal.price);
  const deposits = { sharer: money(deal.sharerDeposit), seeker: money(deal.seekerDeposit) };
  const deposit = role === "seeker" ? deposits.seeker : deposits.sharer;
  const opened = Number(deal.disputeOpenedAt);

  return {
    id: id.toString(),
    type: deal.policy.dealType === 0 ? "BuyForYou" : "PassOn",
    category: category?.key ?? `category-${deal.category}`,
    categoryLabel: category
      ? CATEGORY_LABELS[category.key as CategoryKey]
      : `Category ${deal.category}`,
    status: STATUS_NAMES[deal.status as DealStatus],
    statusLabel: STATUS_LABELS[deal.status as DealStatus],
    role,
    nextAction: action.nextAction,
    secondaryActions: action.secondary,
    actionReason: action.reason ?? null,
    price,
    priceMstc: price.mstc,
    priceInr: price.inr,
    deposit,
    depositMstc: deposit.mstc,
    deposits,
    payAmount: money(deal.price + deal.seekerDeposit),
    feeBps: Number(deal.feeBps),
    deadlines: {
      deliverBy: iso(deal.deliverBy),
      releaseAt: iso(deal.releaseAt),
      eventTime: iso(deal.eventTime),
      evidenceUntil: opened > 0 ? iso(opened + Number(deal.policy.disputeWindow)) : null,
      defaultRulingAt: opened > 0 ? iso(opened + Number(deal.arbiterTimeout)) : null,
    },
    sharer: getAddress(deal.sharer),
    seeker: hasSeeker ? getAddress(deal.seeker) : null,
    counterpartTrust:
      counterpart && counterpartTrust ? trustView(counterpart, counterpartTrust) : null,
    listing: listing
      ? {
          title: listing.title,
          description: listing.description,
          faceValueInr: listing.faceValueInr,
          priceInr: listing.priceInr,
          terms: listing.terms,
        }
      : null,
    hashes: {
      termsHash: deal.termsHash,
      codeFingerprint: deal.codeFingerprint,
      proofHash: deal.proofHash,
    },
    mstscanUrls: {
      escrow: explorerAddressUrl(escrowContract().address),
      sharer: explorerAddressUrl(getAddress(deal.sharer)),
      seeker: hasSeeker ? explorerAddressUrl(getAddress(deal.seeker)) : null,
    },
    timeline: events.map((event) => ({
      event: event.name,
      label: TIMELINE_LABELS[event.name]?.(event.args) ?? event.name,
      at: new Date(event.timestamp * 1000).toISOString(),
      txHash: event.transactionHash,
      url: explorerTxUrl(event.transactionHash),
    })),
    chainTime: new Date(now * 1000).toISOString(),
  };
}
