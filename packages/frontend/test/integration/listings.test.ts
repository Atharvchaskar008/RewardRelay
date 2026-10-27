import { beforeAll, describe, expect, it, vi } from "vitest";
import { parseEventLogs, zeroHash, type Hex } from "viem";
import { inrToWei, relayEscrowAbi } from "rewardrelay-shared";
import { POST as authorizeRoute } from "@/app/api/codes/authorize/route";
import { GET as dealRoute } from "@/app/api/deals/[id]/route";
import { GET as listRoute, POST as createRoute } from "@/app/api/listings/route";
import { listingTermsHash } from "@/src/common/terms";
import { db } from "@/src/server/firebaseAdmin";
import type { DealView } from "@/src/server/views/deal";
import type { ListingView } from "@/src/server/listings/service";
import {
  callRoute,
  chainFixture,
  onboard,
  resetEmulators,
  useIntegrationEnv,
} from "../helpers/integration";

const silence = (["log", "warn", "error"] as const).map((method) =>
  vi.spyOn(console, method).mockImplementation(() => undefined),
);

type User = Awaited<ReturnType<typeof onboard>>;
let sharer: User;
let seeker: User;
let outsider: User;
const RATE = 100_000;

beforeAll(async () => {
  useIntegrationEnv();
  await resetEmulators();
  sharer = await onboard();
  seeker = await onboard();
  outsider = await onboard();
  return () => silence.forEach((spy) => spy.mockRestore());
});

interface ListingInput {
  title: string;
  description: string;
  category: string;
  faceValueInr: number;
  priceInr: number;
  eventTime: number;
  terms: Record<string, string | number | boolean | string[]>;
}

function buyForYou(overrides: Partial<ListingInput> = {}): ListingInput {
  return {
    title: "Rs 400 off electronics with Bank A",
    description: "I order in my account and ship to you",
    category: "ecommerce",
    faceValueInr: 450,
    priceInr: 300,
    eventTime: 0,
    terms: { validTill: "2026-11-30", maxOrder: 5000 },
    ...overrides,
  };
}

const termsHashOf = (input: ListingInput) =>
  listingTermsHash({
    title: input.title,
    description: input.description,
    category: input.category,
    faceValueInr: input.faceValueInr,
    priceInr: input.priceInr,
    eventTime: input.eventTime,
    conditions: input.terms,
  });

/** Sends createListing from the user's wallet and returns the new deal id. */
async function createOnChain(
  user: User,
  input: ListingInput,
  categoryId: number,
  passOn?: { fingerprint: Hex; auth: { nonce: string; deadline: string; signature: Hex } },
): Promise<bigint> {
  const { escrow } = chainFixture();
  const price = inrToWei(input.priceInr, RATE);
  const deposit = await user.publicClient.readContract({
    address: escrow,
    abi: relayEscrowAbi,
    functionName: "requiredSharerDeposit",
    args: [user.account.address, price],
  });
  const hash = await user.walletClient.writeContract({
    address: escrow,
    abi: relayEscrowAbi,
    functionName: "createListing",
    args: [
      categoryId,
      price,
      BigInt(input.eventTime),
      termsHashOf(input),
      passOn?.fingerprint ?? zeroHash,
      passOn
        ? {
            nonce: BigInt(passOn.auth.nonce),
            deadline: BigInt(passOn.auth.deadline),
            signature: passOn.auth.signature,
          }
        : { nonce: 0n, deadline: 0n, signature: "0x" },
    ],
    value: deposit,
  });
  const receipt = await user.publicClient.waitForTransactionReceipt({ hash });
  const [created] = parseEventLogs({
    abi: relayEscrowAbi,
    logs: receipt.logs,
    eventName: "ListingCreated",
  });
  return created.args.id;
}

async function accept(user: User, id: bigint) {
  const { escrow } = chainFixture();
  const deal = await user.publicClient.readContract({
    address: escrow,
    abi: relayEscrowAbi,
    functionName: "getDeal",
    args: [id],
  });
  const hash = await user.walletClient.writeContract({
    address: escrow,
    abi: relayEscrowAbi,
    functionName: "acceptListing",
    args: [id],
    value: deal.price + deal.seekerDeposit,
  });
  await user.publicClient.waitForTransactionReceipt({ hash });
}

const publish = (user: User, dealId: bigint, input: ListingInput) =>
  callRoute<ListingView>(createRoute, {
    token: user.idToken,
    body: { dealId: dealId.toString(), ...input },
  });

describe("Buy-for-you listing", () => {
  let dealId: bigint;
  const input = buyForYou();

  it("publishes chain-verified metadata", async () => {
    dealId = await createOnChain(sharer, input, 0);
    const res = await publish(sharer, dealId, input);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      dealId: dealId.toString(),
      status: "Listed",
      statusLabel: "Open",
      dealType: "BuyForYou",
      category: "ecommerce",
      priceInr: 300,
      price: { mstc: "0.003", inr: 300 },
      sharer: sharer.account.address,
      sharerTrust: { tier: 0, tierName: "New" },
    });
  });

  it("rejects spoofed or inconsistent metadata", async () => {
    const other = await createOnChain(sharer, buyForYou({ title: "Second offer" }), 0);
    const second = buyForYou({ title: "Second offer" });

    const wrongSharer = await publish(outsider, other, second);
    expect(wrongSharer.status).toBe(403);

    const wrongTerms = await publish(sharer, other, { ...second, title: "Different title" });
    expect(wrongTerms.status).toBe(409);
    expect(wrongTerms.body.error).toMatchObject({ code: "CHAIN_STATE_MISMATCH" });
    expect(wrongTerms.body.error.message).toMatch(/terms hash/);

    const wrongPrice = await publish(sharer, other, { ...second, priceInr: 301 });
    expect(wrongPrice.status).toBe(409);
    expect(wrongPrice.body.error.message).toMatch(/price/);

    const wrongCategory = await publish(sharer, other, { ...second, category: "food" });
    expect(wrongCategory.status).toBe(409);

    const blocked = await publish(sharer, other, {
      ...second,
      description: "IRCTC tatkal tickets",
    });
    expect(blocked.status).toBe(400);

    const unknownDeal = await publish(sharer, 999_999n, second);
    expect(unknownDeal.status).toBe(404);

    expect((await publish(sharer, other, second)).status).toBe(201);
    expect((await publish(sharer, other, second)).status).toBe(409); // already published
  });

  it("lists open deals with chain status and sharer trust", async () => {
    const res = await callRoute<{ items: ListingView[]; nextCursor: string | null }>(listRoute, {
      url: "http://localhost:3000/api/listings?category=ecommerce",
    });
    expect(res.status).toBe(200);
    const ids = res.body.data.items.map((item) => item.dealId);
    expect(ids).toContain(dealId.toString());
    expect(res.body.data.items.every((item) => item.status === "Listed")).toBe(true);
  });

  it("gives every role its next action, and leaves the open feed once paid", async () => {
    const asVisitor = await callRoute<DealView>(dealRoute, {
      token: seeker.idToken,
      params: { id: dealId.toString() },
    });
    expect(asVisitor.body.data).toMatchObject({
      role: "visitor",
      nextAction: "PAY",
      payAmount: { mstc: "0.00315" },
    });
    const asSharer = await callRoute<DealView>(dealRoute, {
      token: sharer.idToken,
      params: { id: dealId.toString() },
    });
    expect(asSharer.body.data).toMatchObject({
      role: "sharer",
      nextAction: "WAIT",
      secondaryActions: ["CANCEL"],
    });
    const anonymous = await callRoute<DealView>(dealRoute, { params: { id: dealId.toString() } });
    expect(anonymous.body.data).toMatchObject({
      role: "visitor",
      nextAction: "NONE",
      actionReason: "SIGN_IN",
    });

    await accept(seeker, dealId);

    const locked = await callRoute<DealView>(dealRoute, {
      token: seeker.idToken,
      params: { id: dealId.toString() },
    });
    expect(locked.body.data).toMatchObject({
      role: "seeker",
      status: "Locked",
      nextAction: "WAIT",
    });
    expect(locked.body.data.deadlines.deliverBy).not.toBeNull();
    expect(locked.body.data.counterpartTrust?.address).toBe(sharer.account.address);
    expect(locked.body.data.timeline.map((entry) => entry.event)).toEqual([
      "ListingCreated",
      "DealLocked",
    ]);
    const forSharer = await callRoute<DealView>(dealRoute, {
      token: sharer.idToken,
      params: { id: dealId.toString() },
    });
    expect(forSharer.body.data.nextAction).toBe("MARK_DELIVERED");

    const feed = await callRoute<{ items: ListingView[] }>(listRoute, {
      url: "http://localhost:3000/api/listings",
    });
    expect(feed.body.data.items.map((item) => item.dealId)).not.toContain(dealId.toString());
    const index = (await db().collection("deals").doc(dealId.toString()).get()).data();
    expect(index).toMatchObject({ status: "Locked", seekerUid: seeker.uid });
  });

  it("returns 404 for an unknown deal and 400 for a malformed id", async () => {
    expect((await callRoute(dealRoute, { params: { id: "424242" } })).status).toBe(404);
    expect((await callRoute(dealRoute, { params: { id: "abc" } })).status).toBe(400);
  });
});

describe("Pass-on listing", () => {
  it("authorises a code the contract accepts, then blocks the same code again", async () => {
    const auth = await callRoute<{
      fingerprint: Hex;
      auth: { nonce: string; deadline: string; signature: Hex };
    }>(authorizeRoute, {
      token: sharer.idToken,
      body: { code: " save-20 now ", category: "coupon" },
    });
    expect(auth.status).toBe(200);
    const input = buyForYou({
      title: "Rs 20 off UPI scratch card",
      category: "coupon",
      faceValueInr: 20,
      priceInr: 10,
    });
    const id = await createOnChain(sharer, input, 5, auth.body.data);
    expect((await publish(sharer, id, input)).status).toBe(201);

    const vault = (await db().collection("vault").doc(auth.body.data.fingerprint).get()).data();
    expect(vault).toMatchObject({ status: "listed", dealId: id.toString(), sharerUid: sharer.uid });
    expect(JSON.stringify(vault)).not.toContain("SAVE-20NOW");

    const again = await callRoute(authorizeRoute, {
      token: outsider.idToken,
      body: { code: "SAVE-20NOW", category: "coupon" },
    });
    expect(again.status).toBe(409);
  });

  it("refuses codes for Buy-for-you categories and malformed codes", async () => {
    const wrongCategory = await callRoute(authorizeRoute, {
      token: sharer.idToken,
      body: { code: "ABC123", category: "ecommerce" },
    });
    expect(wrongCategory.status).toBe(400);
    const malformed = await callRoute(authorizeRoute, {
      token: sharer.idToken,
      body: { code: "!!", category: "coupon" },
    });
    expect(malformed.status).toBe(400);
  });
});
