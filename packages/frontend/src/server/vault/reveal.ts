import "server-only";
import { DealStatus } from "rewardrelay-shared";
import { keyring } from "../crypto";
import { logAccess, requireParty } from "../deals/access";
import { AppError } from "../errors";
import { repos } from "../repositories";
import { transaction } from "../repositories/collection";
import type { AuthUser } from "../services";

/**
 * Code Vault reveal: the Pass-on code is decrypted only for the deal's seeker, and only while the
 * chain shows the payment in escrow or settled for them (Delivered, Disputed, Completed). The first
 * reveal is timestamped once; every reveal is logged.
 */
export async function revealCode(user: AuthUser, idParam: string | undefined) {
  const ctx = await requireParty(user, idParam, {
    roles: ["seeker"],
    statuses: [DealStatus.Delivered, DealStatus.Disputed, DealStatus.Completed],
    stateError: "VAULT_LOCKED",
    stateMessage: "The code unlocks for the seeker once the payment is in escrow.",
  });
  if (ctx.deal.policy.dealType !== 1) {
    throw new AppError("VALIDATION_FAILED", { message: "Only Pass-on deals have a code." });
  }
  const fingerprint = ctx.deal.codeFingerprint;
  const vault = await repos.vault.get(fingerprint);
  if (!vault || vault.dealId !== ctx.dealId) {
    throw new AppError("NOT_FOUND", { message: "The code for this deal is not in the vault." });
  }

  const code = keyring().decrypt(vault.code, `vault/${fingerprint}`).toString("utf8");
  const revealedAt = await transaction(async (tx) => {
    const current = await repos.vault.get(fingerprint, tx);
    if (current?.revealedAt) return current.revealedAt;
    const now = Date.now();
    await repos.vault.update(fingerprint, { revealedAt: now, status: "revealed" }, tx);
    return now;
  });
  await logAccess(ctx.dealId, user.uid, "code", ctx.role);
  return {
    dealId: ctx.dealId,
    code,
    fingerprint,
    firstRevealedAt: new Date(revealedAt).toISOString(),
  };
}
