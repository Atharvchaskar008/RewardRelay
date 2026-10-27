import { parseEventLogs, zeroHash, type Hex } from "viem";
import { inrToWei, relayEscrowAbi } from "@rewardrelay/shared";
import { listingTermsHash } from "@/common/terms";
import { callRoute, chainFixture, type onboard } from "./integration";

/** On-chain deal actions from a test user's wallet, plus listing publication through the API. */

export type User = Awaited<ReturnType<typeof onboard>>;

export const RATE = 100_000;

export interface ListingInput {
  title: string;
  description: string;
  category: string;
  faceValueInr: number;
  priceInr: number;
  eventTime: number;
  terms: Record<string, string | number | boolean | string[]>;
}

export interface PassOnAuth {
  fingerprint: Hex;
  auth: { nonce: string; deadline: string; signature: Hex };
}

export function listingInput(overrides: Partial<ListingInput> = {}): ListingInput {
  return {
    title: "Rs 400 off electronics with Bank A",
    description: "I order in my account and ship to you",
    category: "ecommerce",
    faceValueInr: 450,
    priceInr: 300,
    eventTime: 0,
    terms: { validTill: "2026-11-30" },
    ...overrides,
  };
}

export function termsHashOf(input: ListingInput): Hex {
  return listingTermsHash({
    title: input.title,
    description: input.description,
    category: input.category,
    faceValueInr: input.faceValueInr,
    priceInr: input.priceInr,
    eventTime: input.eventTime,
    conditions: input.terms,
  });
}

async function send(user: User, functionName: string, args: unknown[], value?: bigint) {
  const hash = await user.walletClient.writeContract({
    address: chainFixture().escrow,
    abi: relayEscrowAbi,
    functionName,
    args,
    value,
  } as never);
  const receipt = await user.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${functionName} reverted`);
  return receipt;
}

export async function readDealOnChain(user: User, id: bigint) {
  return user.publicClient.readContract({
    address: chainFixture().escrow,
    abi: relayEscrowAbi,
    functionName: "getDeal",
    args: [id],
  });
}

export async function createListingOnChain(
  user: User,
  input: ListingInput,
  categoryId: number,
  passOn?: PassOnAuth,
): Promise<bigint> {
  const price = inrToWei(input.priceInr, RATE);
  const deposit = await user.publicClient.readContract({
    address: chainFixture().escrow,
    abi: relayEscrowAbi,
    functionName: "requiredSharerDeposit",
    args: [user.account.address, price],
  });
  const receipt = await send(
    user,
    "createListing",
    [
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
    deposit,
  );
  const [created] = parseEventLogs({
    abi: relayEscrowAbi,
    logs: receipt.logs,
    eventName: "ListingCreated",
  });
  return created.args.id;
}

export async function acceptOnChain(user: User, id: bigint) {
  const deal = await readDealOnChain(user, id);
  await send(user, "acceptListing", [id], deal.price + deal.seekerDeposit);
}

export const markDeliveredOnChain = (user: User, id: bigint, proofHash: Hex) =>
  send(user, "markDelivered", [id, proofHash]);
export const confirmOnChain = (user: User, id: bigint) => send(user, "confirmReceipt", [id]);
export const raiseDisputeOnChain = (user: User, id: bigint, evidenceHash: Hex) =>
  send(user, "raiseDispute", [id, evidenceHash]);
export const addEvidenceOnChain = (user: User, id: bigint, evidenceHash: Hex) =>
  send(user, "addEvidence", [id, evidenceHash]);

/** Publishes listing metadata through POST /api/listings. */
export async function publishListing(user: User, id: bigint, input: ListingInput) {
  const { POST } = await import("@/app/api/listings/route");
  return callRoute(POST, { token: user.idToken, body: { dealId: id.toString(), ...input } });
}

/** Creates + publishes a Buy-for-you listing and returns its id. */
export async function openBuyForYou(
  user: User,
  overrides: Partial<ListingInput> = {},
): Promise<bigint> {
  const input = listingInput(overrides);
  const id = await createListingOnChain(user, input, 0);
  const published = await publishListing(user, id, input);
  if (published.status !== 201)
    throw new Error(`publish failed: ${JSON.stringify(published.body)}`);
  return id;
}

/** Advances the local chain's clock and mines a block. */
export async function increaseTime(user: User, seconds: number) {
  await user.publicClient.request({
    method: "evm_increaseTime" as never,
    params: [seconds] as never,
  });
  await user.publicClient.request({ method: "evm_mine" as never, params: [] as never });
}

/** Opens a Buy-for-you deal, pays it, submits an order proof via the API and marks it delivered. */
export async function deliverWithProof(
  sharer: User,
  seeker: User,
  overrides: Partial<ListingInput> = {},
): Promise<bigint> {
  const { POST: proofRoute } = await import("@/app/api/deals/[id]/proof/route");
  const id = await openBuyForYou(sharer, {
    title: `Deal ${Math.random().toString(36).slice(2, 10)}`,
    ...overrides,
  });
  await acceptOnChain(seeker, id);
  const proof = await callRoute<{ proofHash: Hex }>(proofRoute, {
    token: sharer.idToken,
    params: { id: id.toString() },
    body: { orderId: `OD-${id}-0001` },
  });
  await markDeliveredOnChain(sharer, id, proof.body.data.proofHash);
  return id;
}
