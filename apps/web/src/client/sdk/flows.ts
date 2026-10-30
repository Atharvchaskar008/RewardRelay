import { createWalletClient, custom, type Address, type EIP1193Provider, type Hex } from "viem";
import {
  categoryByKey,
  inrToWei,
  type NextAction,
  type SecondaryAction,
} from "@rewardrelay/shared";
import { deliveryDetailsProblem } from "@/common/deliveryDetails";
import { listingTermsHash } from "@/common/terms";
import type { EmbeddedWallet } from "@/client/wallet";
import type { ApiClient } from "./api";
import * as tx from "./chain";
import type { ChainConfig, ChainContext, TxOutcome } from "./chain";
import { ChainError, REVERT_MESSAGES, toChainError } from "./errors";
import type {
  DealView,
  DeliveryDetails,
  EvidenceClaim,
  ListingDraft,
  ListingView,
  UserView,
} from "./types";

/**
 * One function per user step. Each combines the API calls and the transaction the step needs, in
 * the right order, so the UI only collects input and shows results. All amounts come from the server
 * view model or the contract; the UI never computes wei itself (except the ₹ → wei price, which
 * uses the shared demo-rate helper the server re-checks).
 */

export interface SdkContext {
  api: ApiClient;
  chain: ChainContext;
  /** ₹ per 1 MSTC (demo rate; must equal the server's DEMO_RATE_INR_PER_MSTC). */
  inrPerMstc: number;
}

// ---------------------------------------------------------------------------------------------
// Wallet onboarding
// ---------------------------------------------------------------------------------------------

/**
 * After phone sign-in: creates (or unlocks) the embedded wallet with the PIN, proves ownership with a
 * signed challenge, links it (badge + top-up happen server-side) and uploads the encrypted backup.
 */
export async function onboardWallet(
  api: ApiClient,
  wallet: EmbeddedWallet,
  pin: string,
): Promise<UserView> {
  const existing = await wallet.storedAddress();
  if (existing) await wallet.unlock(pin);
  else await wallet.create(pin);
  const account = wallet.getAccount();
  const challenge = await api.auth.challenge(account.address);
  const signature = await wallet.signMessage(challenge.message);
  const view = await api.auth.linkWallet({
    address: account.address,
    message: challenge.message,
    signature,
    walletKind: "embedded",
  });
  await api.wallet.putBackup(await wallet.exportBackup());
  return view;
}

/**
 * Links a browser wallet (BridgeKey, MetaMask, …) to the phone-verified account instead of a device
 * wallet: the wallet shares its account and signs the server's challenge (no transaction, no gas).
 * There is no backup: the wallet itself holds the key.
 */
export async function onboardInjectedWallet(
  api: ApiClient,
  provider: EIP1193Provider,
  config?: ChainConfig,
): Promise<{ view: UserView; address: Address }> {
  // If config is provided (e.g. MST Chain 4646), prompt the wallet to add or switch to it first
  if (config) {
    try {
      const client = createWalletClient({ transport: custom(provider) });
      await tx.ensureWalletChain(client, config).catch(() => {});
    } catch {
      // Continue to address request
    }
  }

  const address = await tx.requestWalletAddress(provider);

  // 1. Fetch SIWE challenge directly
  const challenge = await api.auth.challenge(address);

  // 2. Request signature from the wallet with fallbacks for BridgeKey
  let signature: Hex;
  try {
    signature = await createWalletClient({ transport: custom(provider) }).signMessage({
      account: address,
      message: challenge.message,
    });
  } catch (error) {
    const raw = provider as unknown as {
      request: (args: {
        method: string;
        params?: unknown[] | Record<string, unknown>;
      }) => Promise<unknown>;
    };
    try {
      const hex = ("0x" + Buffer.from(challenge.message, "utf8").toString("hex")) as Hex;
      signature = (await raw.request({
        method: "personal_sign",
        params: [hex, address],
      })) as Hex;
    } catch {
      try {
        signature = (await raw.request({
          method: "personal_sign",
          params: [challenge.message, address],
        })) as Hex;
      } catch {
        try {
          signature = (await raw.request({
            method: "personal_sign",
            params: [address, challenge.message],
          })) as Hex;
        } catch {
          throw toChainError(error);
        }
      }
    }
  }

  // 3. Authenticate with Firebase for this wallet
  const { token } = await api.auth.token(address);
  const { signInWithWalletToken } = await import("@/client/firebase");
  await signInWithWalletToken(token);

  // 4. Link wallet
  const view = await api.auth.linkWallet({
    address,
    message: challenge.message,
    signature,
    walletKind: "injected",
  });
  return { view, address };
}

/** On a new device: downloads the encrypted backup and restores it with the PIN. */
export async function restoreWallet(
  api: ApiClient,
  wallet: EmbeddedWallet,
  pin: string,
): Promise<Address> {
  const backup = await api.wallet.getBackup();
  return wallet.restore(backup, pin);
}

// ---------------------------------------------------------------------------------------------
// Sharer
// ---------------------------------------------------------------------------------------------

function termsFor(draft: ListingDraft) {
  return {
    title: draft.title,
    description: draft.description,
    category: draft.category,
    faceValueInr: draft.faceValueInr,
    priceInr: draft.priceInr,
    eventTime: draft.eventTime ?? 0,
    conditions: draft.terms ?? {},
  };
}

async function publish(sdk: SdkContext, dealId: bigint, draft: ListingDraft): Promise<ListingView> {
  return sdk.api.listings.create({
    dealId: dealId.toString(),
    title: draft.title,
    description: draft.description,
    category: draft.category,
    faceValueInr: draft.faceValueInr,
    priceInr: draft.priceInr,
    eventTime: draft.eventTime || null,
    terms: draft.terms ?? {},
  });
}

/** Buy-for-you: createListing (deposit from the contract) → publish the chain-verified metadata. */
/**
 * The contract refuses a price above the Sharer's Trust Badge limit, but a wallet that cannot cover the
 * deposit fails the simulation first with "not enough MSTC". Checking the limit before anything is
 * signed gives the reason that actually applies.
 */
async function assertWithinLimit(sdk: SdkContext, price: bigint): Promise<void> {
  const me = await sdk.api.me();
  if (me && price > BigInt(me.badge.maxDealValue.wei)) {
    throw new ChainError(REVERT_MESSAGES.DealValueAboveLimit, "DealValueAboveLimit");
  }
}

export async function listBuyForYou(sdk: SdkContext, draft: ListingDraft) {
  const category = categoryByKey(draft.category);
  if (!category || category.dealType !== "BuyForYou")
    throw new ChainError("Choose a Buy-for-you category.");
  const price = inrToWei(draft.priceInr, sdk.inrPerMstc);
  await assertWithinLimit(sdk, price);
  const created = await tx.createListing(sdk.chain, {
    categoryId: category.id,
    price,
    eventTime: BigInt(draft.eventTime ?? 0),
    termsHash: listingTermsHash(termsFor(draft)),
  });
  return { tx: created, listing: await publish(sdk, created.dealId, draft) };
}

/** Pass-on: seal the code in the vault (server signs the authorisation) → createListing → publish. */
export async function listPassOn(sdk: SdkContext, draft: ListingDraft, code: string) {
  const category = categoryByKey(draft.category);
  if (!category || category.dealType !== "PassOn")
    throw new ChainError("Choose a Pass-on category.");
  const price = inrToWei(draft.priceInr, sdk.inrPerMstc);
  await assertWithinLimit(sdk, price);
  const authorization = await sdk.api.codes.authorize({ code, category: category.key });
  const created = await tx.createListing(sdk.chain, {
    categoryId: category.id,
    price,
    eventTime: BigInt(draft.eventTime ?? 0),
    termsHash: listingTermsHash(termsFor(draft)),
    fingerprint: authorization.fingerprint,
    auth: {
      nonce: BigInt(authorization.auth.nonce),
      deadline: BigInt(authorization.auth.deadline),
      signature: authorization.auth.signature,
    },
  });
  return { tx: created, listing: await publish(sdk, created.dealId, draft) };
}

/** Sharer delivers a Buy-for-you order: proof (+ invoice) to the API → markDelivered(proofHash). */
export async function deliverOrder(
  sdk: SdkContext,
  dealId: string,
  input: { orderId: string; notes?: string; invoice?: Blob },
) {
  const proof = await sdk.api.deals.submitProof(dealId, input);
  const outcome = await tx.markDelivered(sdk.chain, BigInt(dealId), proof.proofHash);
  return { proof, tx: outcome };
}

// ---------------------------------------------------------------------------------------------
// Seeker
// ---------------------------------------------------------------------------------------------

/**
 * acceptListing with price + deposit; for Buy-for-you also sends the delivery details, which are
 * checked first so a payment is never locked without a valid address.
 */
export async function payForDeal(sdk: SdkContext, dealId: string, details?: DeliveryDetails) {
  const before = await sdk.api.deals.get(dealId);
  const needsDetails = before.type === "BuyForYou";
  if (needsDetails) {
    const problem = deliveryDetailsProblem(details);
    if (problem) throw new ChainError(problem);
  }
  const outcome = await tx.acceptListing(sdk.chain, BigInt(dealId));
  if (needsDetails && details) await sdk.api.deals.submitDetails(dealId, details);
  return { tx: outcome, deal: await sdk.api.deals.get(dealId) };
}

/** Seeker of a paid Buy-for-you deal: sends (or corrects) the delivery address. */
export async function sendDeliveryDetails(
  sdk: SdkContext,
  dealId: string,
  details: DeliveryDetails,
): Promise<DealView> {
  const problem = deliveryDetailsProblem(details);
  if (problem) throw new ChainError(problem);
  await sdk.api.deals.submitDetails(dealId, details);
  return sdk.api.deals.get(dealId);
}

/** Seeker opens a dispute: evidence to the API → raiseDispute(evidenceHash). */
export async function raiseDispute(
  sdk: SdkContext,
  dealId: string,
  evidence: { claim: EvidenceClaim; text: string; files?: Blob[] },
) {
  const receipt = await sdk.api.disputes.submitEvidence(dealId, evidence);
  if (receipt.onChainAction !== "raiseDispute") throw new ChainError("A dispute is already open.");
  return {
    evidence: receipt,
    tx: await tx.raiseDispute(sdk.chain, BigInt(dealId), receipt.evidenceHash),
  };
}

/** Either party adds evidence to an open dispute: evidence to the API → addEvidence(evidenceHash). */
export async function addEvidence(
  sdk: SdkContext,
  dealId: string,
  evidence: { claim: EvidenceClaim; text: string; files?: Blob[] },
) {
  const receipt = await sdk.api.disputes.submitEvidence(dealId, evidence);
  return {
    evidence: receipt,
    tx: await tx.addEvidence(sdk.chain, BigInt(dealId), receipt.evidenceHash as Hex),
  };
}

// ---------------------------------------------------------------------------------------------
// The deal room's buttons
// ---------------------------------------------------------------------------------------------

/** Input some actions need (collected by the UI before calling runDealAction). */
export interface DealActionInput {
  details?: DeliveryDetails;
  proof?: { orderId: string; notes?: string; invoice?: Blob };
  evidence?: { claim: EvidenceClaim; text: string; files?: Blob[] };
}

export type DealAction = NextAction | SecondaryAction;

/**
 * Runs the transaction (plus API calls) behind a button from the deal view's `nextAction` or
 * `secondaryActions`, then returns the refreshed view.
 */
export async function runDealAction(
  sdk: SdkContext,
  deal: Pick<DealView, "id">,
  action: DealAction,
  input: DealActionInput = {},
): Promise<{ deal: DealView; tx?: TxOutcome }> {
  const id = BigInt(deal.id);
  let outcome: TxOutcome | undefined;
  switch (action) {
    case "PAY":
      outcome = (await payForDeal(sdk, deal.id, input.details)).tx;
      break;
    case "MARK_DELIVERED":
      if (!input.proof) throw new ChainError("Enter the order id first.");
      outcome = (await deliverOrder(sdk, deal.id, input.proof)).tx;
      break;
    case "CONFIRM":
      outcome = await tx.confirmReceipt(sdk.chain, id);
      break;
    case "RELEASE_AVAILABLE":
      outcome = await tx.release(sdk.chain, id);
      break;
    case "CLAIM_REFUND":
      outcome = await tx.claimTimeout(sdk.chain, id);
      break;
    case "CANCEL":
      outcome = await tx.cancelListing(sdk.chain, id);
      break;
    case "RAISE_DISPUTE":
      if (!input.evidence) throw new ChainError("Describe the problem first.");
      outcome = (await raiseDispute(sdk, deal.id, input.evidence)).tx;
      break;
    case "ADD_EVIDENCE":
      if (!input.evidence) throw new ChainError("Add your evidence first.");
      outcome = (await addEvidence(sdk, deal.id, input.evidence)).tx;
      break;
    case "DEFAULT_RESOLVE":
      outcome = await tx.defaultResolve(sdk.chain, id);
      break;
    case "WAIT":
    case "NONE":
      break;
  }
  return { deal: await sdk.api.deals.get(deal.id), tx: outcome };
}
