import "server-only";
import { getAddress, type Address, type Hex } from "viem";
import { reputationSbtAbi } from "rewardrelay-shared";
import { sbtContract } from "../chain";
import { keyring } from "../crypto";
import { serverEnv } from "../env";
import { AppError } from "../errors";
import { errorFields, log } from "../log";
import { repos } from "../repositories";
import { transaction } from "../repositories/collection";
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
  input: { address: Address; message: string; signature: Hex },
): Promise<UserView> {
  if (!user.phoneNumber) {
    throw new AppError("FORBIDDEN", { message: "Sign in with your phone number first." });
  }
  const address = getAddress(input.address);
  await consumeChallenge({
    uid: user.uid,
    address,
    message: input.message,
    signature: input.signature,
  });

  const phoneHash = keyring().phoneHash(user.phoneNumber);
  await claimIdentity(user.uid, phoneHash, address);
  await ensureBadge(user.uid, address);
  await ensureTopup(user.uid, address);

  return buildUserView(address, await repos.users.get(user.uid));
}

/** Transactionally binds uid ↔ phone hash ↔ wallet; any other existing binding is a CONFLICT. */
async function claimIdentity(uid: string, phoneHash: Hex, wallet: Address): Promise<void> {
  const walletKey = wallet.toLowerCase();
  await transaction(async (tx) => {
    const existing = await repos.users.get(uid, tx);
    const phoneClaim = await repos.phoneIndex.get(phoneHash, tx);
    const walletClaim = await repos.walletIndex.get(walletKey, tx);

    if (existing && existing.wallet.toLowerCase() !== walletKey) {
      throw conflict("Your account is already linked to another wallet.");
    }
    if (existing && existing.phoneHash !== phoneHash) {
      throw conflict("Your account is linked to a different phone number.");
    }
    if (phoneClaim && phoneClaim.uid !== uid) {
      throw conflict("This phone number is already linked to another wallet.");
    }
    if (walletClaim && walletClaim.uid !== uid) {
      throw conflict("This wallet is already linked to another phone number.");
    }
    if (existing) return;

    const now = Date.now();
    await repos.users.create(uid, { uid, wallet, phoneHash, createdAt: now, updatedAt: now }, tx);
    await repos.phoneIndex.create(phoneHash, { uid, wallet, createdAt: now }, tx);
    await repos.walletIndex.create(walletKey, { uid, phoneHash, createdAt: now }, tx);
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

async function ensureBadge(uid: string, wallet: Address): Promise<void> {
  if (await sbtContract().read.hasBadge([wallet])) {
    const user = await repos.users.get(uid);
    if (user?.badge?.status !== "minted") {
      await repos.users.update(uid, { badge: { status: "existing", at: Date.now() } });
    }
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
    await repos.users.update(uid, {
      badge: { status: "minted", txHash: result.hash, at: Date.now() },
      updatedAt: Date.now(),
    });
  } catch (error) {
    // Another request may have minted in the meantime; the chain decides.
    if (await sbtContract().read.hasBadge([wallet])) {
      await repos.users.update(uid, { badge: { status: "existing", at: Date.now() } });
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
    // The account works without the top-up; the next link attempt retries a failed one.
  }
}
