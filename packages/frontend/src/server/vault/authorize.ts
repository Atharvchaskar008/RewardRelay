import "server-only";
import type { Hex } from "viem";
import { CODE_PATTERN, categoryByKey, normalizeCode } from "rewardrelay-shared";
import { escrowContract } from "../chain";
import { keyring, signListingAuth } from "../crypto";
import { AppError } from "../errors";
import { requireLinkedUser } from "../identity/users";
import { repos } from "../repositories";
import { transaction } from "../repositories/collection";

/** Authorisations are valid for 15 minutes: enough to sign createListing, short enough to expire. */
export const LISTING_AUTH_TTL_SECONDS = 15 * 60;

// ---------------------------------------------------------------------------------------------
// Pass-on: code fingerprint + EIP-712 authorisation (before createListing)
// ---------------------------------------------------------------------------------------------

export interface CodeAuthorization {
  fingerprint: Hex;
  auth: { nonce: string; deadline: string; signature: Hex };
  category: string;
}

export async function authorizeCode(
  uid: string,
  input: { code: string; category: string },
): Promise<CodeAuthorization> {
  const user = await requireLinkedUser(uid);
  const category = categoryByKey(input.category);
  if (!category || category.dealType !== "PassOn") {
    throw new AppError("VALIDATION_FAILED", { message: "Only Pass-on categories take a code." });
  }
  const code = normalizeCode(input.code);
  if (!CODE_PATTERN.test(code)) {
    throw new AppError("VALIDATION_FAILED", {
      message: "Codes are 3-64 letters, digits, dashes or underscores.",
    });
  }

  const fingerprint = keyring().codeFingerprint(code);
  const escrow = escrowContract();
  const [usedOnChain, nonce] = await Promise.all([
    escrow.read.usedFingerprint([fingerprint]),
    escrow.read.nonces([user.address]),
  ]);
  if (usedOnChain)
    throw new AppError("CONFLICT", { message: "This code has already been listed." });

  const path = `vault/${fingerprint}`;
  await transaction(async (tx) => {
    const existing = await repos.vault.get(fingerprint, tx);
    if (existing && (existing.status === "listed" || existing.status === "revealed")) {
      throw new AppError("CONFLICT", { message: "This code has already been listed." });
    }
    if (existing && existing.status === "pending" && existing.sharerUid !== uid) {
      throw new AppError("CONFLICT", { message: "Someone else is already listing this code." });
    }
    await repos.vault.set(
      fingerprint,
      {
        fingerprint,
        sharer: user.address,
        sharerUid: uid,
        status: "pending",
        code: keyring().encrypt(code, path),
        dealId: null,
        createdAt: Date.now(),
        revealedAt: null,
      },
      tx,
    );
  });

  const deadline = BigInt(Math.floor(Date.now() / 1000) + LISTING_AUTH_TTL_SECONDS);
  const signature = await signListingAuth({ sharer: user.address, fingerprint, nonce, deadline });
  return {
    fingerprint,
    auth: { nonce: nonce.toString(), deadline: deadline.toString(), signature },
    category: category.key,
  };
}
