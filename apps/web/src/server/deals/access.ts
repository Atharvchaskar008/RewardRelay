import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import type { Address } from "viem";
import { DealStatus, STATUS_NAMES } from "@rewardrelay/shared";
import type { OnChainDeal } from "../chain";
import { AppError, type ErrorCode } from "../errors";
import { db } from "../firebaseAdmin";
import { walletOf } from "../identity/users";
import type { AuthUser } from "../services";
import { dealIdParam } from "../validation/common";
import { roleOf } from "../views/deal";
import { readDealOrThrow } from "./read";

/**
 * The gate in front of every private deal path: re-read the deal on-chain, then require the
 * caller to be one of the allowed parties and the deal to be in one of the allowed statuses.
 * Non-parties are refused before any state is revealed.
 */

export type Party = "sharer" | "seeker";

export interface PartyContext {
  id: bigint;
  dealId: string;
  deal: OnChainDeal;
  role: Party;
  wallet: Address;
}

export async function requireParty(
  user: AuthUser,
  idParam: string | undefined,
  rule: { roles: Party[]; statuses: DealStatus[]; stateError?: ErrorCode; stateMessage?: string },
): Promise<PartyContext> {
  const id = dealIdParam(idParam);
  const wallet = await walletOf(user.uid);
  if (!wallet) throw new AppError("FORBIDDEN", { message: "Link your wallet first." });
  const deal = await readDealOrThrow(id);
  const role = roleOf(deal, wallet);
  if (role === "visitor" || !rule.roles.includes(role)) {
    throw new AppError("FORBIDDEN", {
      message: `Only this deal's ${rule.roles.join(" or ")} can do this.`,
    });
  }
  if (!rule.statuses.includes(deal.status as DealStatus)) {
    throw new AppError(rule.stateError ?? "CHAIN_STATE_MISMATCH", {
      message: rule.stateMessage,
      details: { status: STATUS_NAMES[deal.status as DealStatus] },
    });
  }
  return { id, dealId: id.toString(), deal, role, wallet };
}

export type AccessKind = "details" | "proof" | "invoice" | "code" | "evidence";

/** Append-only access log (who and when, never what): deals/{id}/access/{auto}. */
export async function logAccess(
  dealId: string,
  uid: string,
  kind: AccessKind,
  role: Party | "admin",
): Promise<void> {
  await db()
    .collection(`deals/${dealId}/access`)
    .add({ uid, role, kind, at: Date.now(), serverTime: FieldValue.serverTimestamp() });
}
