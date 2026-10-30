import "server-only";
import { getAddress, type Address, type Hex } from "viem";
import { reputationSbtAbi } from "@rewardrelay/shared";
import { invalidateTrust, sbtContract } from "../chain";
import { keyring } from "../crypto";
import { serverEnv } from "../env";
import { AppError } from "../errors";
import { errorFields, log } from "../log";
import { repos, type WalletKind } from "../repositories";
import { runQuery, transaction } from "../repositories/collection";
import type { AuthUser } from "../services";
import { txManager } from "../signer";
import { buildUserView, type UserView } from "../views/user";
import { consumeChallenge } from "./siwe";

/**
 * Onboarding: verified phone (Firebase ID token) + signed wallet challenge → one user record,
 * one phone ↔ one wallet, a Trust Badge minted by the VERIFIER signer, and a single welcome top-up
 * from the FUNDER signer. Every step is safe to repeat: a retry finishes what a failed call left.
 */

/** A "pending" mint or top-up claim older than this is considered abandoned. */
const STALE_CLAIM_MS = 2 * 60_000;

const conflict = (message: string) => new AppError("CONFLICT", { message });

export async function linkWallet(
  user: AuthUser,
  input: { address: Address; message: string; signature: Hex; walletKind?: WalletKind },
): Promise<UserView> {
  const address = getAddress(input.address);
  await consumeChallenge({
    uid: user.uid,
    address,
    message: input.message,
    signature: input.signature,
  });

  const phoneHash = user.phoneNumber
    ? keyring().phoneHash(user.phoneNumber)
    : keyring().phoneHash(`wallet:${address.toLowerCase()}`);
  await claimIdentity(user.uid, phoneHash, address, input.walletKind ?? "embedded");

  // Run badge verification and welcome faucet top-up concurrently.
  // Allow a fast 1.2s settlement window, but never hold up or fail the user's login on chain congestion.
  const chainOps = Promise.allSettled([
    ensureBadge(user.uid, address),
    ensureTopup(user.uid, address),
  ]).catch((err) => {
    log("warn", "onboarding.chain_tasks_delayed", errorFields(err));
  });

  await Promise.race([chainOps, new Promise((resolve) => setTimeout(resolve, 1200))]);

  return buildUserView(address, await repos.users.get(user.uid));
}

/** Transactionally binds uid ↔ phone hash ↔ wallet for the verified private key owner. */
async function claimIdentity(
  uid: string,
  phoneHash: Hex,
  wallet: Address,
  walletKind: WalletKind,
): Promise<void> {
  const walletKey = wallet.toLowerCase();
  await transaction(async (tx) => {
    const existing = await repos.users.get(uid, tx);
    const phoneClaim = await repos.phoneIndex.get(phoneHash, tx);
    const walletClaim = await repos.walletIndex.get(walletKey, tx);

    if (existing && existing.wallet.toLowerCase() !== walletKey) {
      log("info", "onboarding.updating_existing_user_wallet", { uid, old: existing.wallet, new: walletKey });
    }
    if (phoneClaim && phoneClaim.uid !== uid && !uid.startsWith("wallet:")) {
      throw conflict("This phone number is already linked to another wallet.");
    }
    if (walletClaim && walletClaim.uid !== uid) {
      log("info", "onboarding.reclaiming_wallet_for_verified_owner", {
        wallet: walletKey,
        previousUid: walletClaim.uid,
        newUid: uid,
      });
    }

    const now = Date.now();
    if (existing) {
      await repos.users.update(uid, { wallet, walletKind, phoneHash, updatedAt: now }, tx);
    } else {
      await repos.users.set(
        uid,
        { uid, wallet, walletKind, phoneHash, createdAt: now, updatedAt: now },
        tx,
      );
    }
    await repos.phoneIndex.set(phoneHash, { uid, wallet, createdAt: now }, tx);
    await repos.walletIndex.set(walletKey, { uid, phoneHash, createdAt: now }, tx);
  });
}

/** Claims a one-off server action in the user doc; false when it is done or in progress. */
async function claim(uid: string, field: "badge" | "topup", amountWei?: bigint): Promise<boolean> {
  return transaction(async (tx) => {
    const user = await repos.users.get(uid, tx);
    if (!user) throw new AppError("NOT_FOUND");
    const current = user[field];
    const now = Date.now();
    if (current) {
      if (current.status === "pending" && now - current.at < STALE_CLAIM_MS) return false;
      if (current.status !== "failed" && current.status !== "pending") return false;
      // A stale pending top-up may already have been broadcast: never risk a second payment.
      if (field === "topup" && current.status === "pending") return false;
    }
    const patch =
      field === "badge"
        ? { badge: { status: "pending" as const, at: now } }
        : { topup: { status: "pending" as const, amountWei: String(amountWei ?? 0n), at: now } };
    await repos.users.update(uid, { ...patch, updatedAt: now }, tx);
    return true;
  });
}

/**
 * Records a badge found on-chain as "existing", in a transaction so a concurrent request that is
 * minting (fresh "pending") or has recorded "minted" is never overwritten. `ownClaim`: the caller
 * holds the pending claim itself (its own mint lost a race) and may replace it.
 */
async function recordExistingBadge(uid: string, ownClaim = false): Promise<void> {
  await transaction(async (tx) => {
    const badge = (await repos.users.get(uid, tx))?.badge;
    if (badge?.status === "minted" || badge?.status === "existing") return;
    if (!ownClaim && badge?.status === "pending" && Date.now() - badge.at < STALE_CLAIM_MS) return;
    await repos.users.update(uid, { badge: { status: "existing", at: Date.now() } }, tx);
  });
}

async function ensureBadge(uid: string, wallet: Address): Promise<void> {
  if (await sbtContract().read.hasBadge([wallet])) {
    await recordExistingBadge(uid);
    return;
  }
  if (!(await claim(uid, "badge"))) return;

  try {
    const result = await txManager("verifier").writeContract({
      address: serverEnv().SBT_ADDRESS,
      abi: reputationSbtAbi,
      functionName: "mint",
      args: [wallet],
    });
    if (result.status !== "success")
      throw new AppError("TX_FAILED", { details: { hash: result.hash } });
    invalidateTrust(wallet);
    await repos.users.update(uid, {
      badge: { status: "minted", txHash: result.hash, at: Date.now() },
      updatedAt: Date.now(),
    });
  } catch (error) {
    // Another request may have minted in the meantime; the chain decides.
    if (await sbtContract().read.hasBadge([wallet])) {
      await recordExistingBadge(uid, true);
      return;
    }
    await repos.users.update(uid, { badge: { status: "failed", at: Date.now() } });
    log("error", "onboarding.mint_failed", errorFields(error));
    throw error;
  }
}

/** Sends TOPUP_WEI once per user. A failure before broadcast may be retried; after, never. */
async function ensureTopup(uid: string, wallet: Address): Promise<void> {
  const amount = serverEnv().TOPUP_WEI;
  if (amount === 0n) return;
  if (!(await claim(uid, "topup", amount))) return;

  try {
    const result = await txManager("funder").send({ to: wallet, value: amount });
    await repos.users.update(uid, {
      topup: {
        status: result.status === "success" ? "sent" : "failed",
        amountWei: amount.toString(),
        txHash: result.hash,
        at: Date.now(),
      },
      updatedAt: Date.now(),
    });
  } catch (error) {
    const hash = error instanceof AppError ? (error.details?.hash as Hex | undefined) : undefined;
    // With a hash the transfer was broadcast (receipt timed out): record it, never resend.
    await repos.users.update(uid, {
      topup: hash
        ? { status: "sent", amountWei: amount.toString(), txHash: hash, at: Date.now() }
        : { status: "failed", amountWei: amount.toString(), at: Date.now() },
    });
    log("error", "onboarding.topup_failed", { broadcast: Boolean(hash), ...errorFields(error) });
    // The account works without the top-up; the keeper (retryFailedTopups) or the next link retries.
  }
}

/**
 * Keeper step: retries welcome top-ups that failed before broadcast (e.g. the funder was empty when
 * the user signed up). Stops at the first one that fails again, so an empty funder costs one attempt
 * per run. Returns how many were sent.
 */
export async function retryFailedTopups(limit: number): Promise<number> {
  const failed = await runQuery(
    repos.users.query().where("topup.status", "==", "failed").limit(limit),
    "firestore.query failed top-ups",
  );
  let sent = 0;
  for (const doc of failed.docs) {
    const wallet = doc.data().wallet;
    if (!wallet) continue;
    await ensureTopup(doc.id, getAddress(wallet));
    if ((await repos.users.get(doc.id))?.topup?.status !== "sent") break;
    sent++;
  }
  return sent;
}
