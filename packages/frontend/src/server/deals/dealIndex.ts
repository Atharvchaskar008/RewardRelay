import "server-only";
import { zeroHash } from "viem";
import { DealStatus, STATUS_NAMES, TERMINAL_STATUSES } from "rewardrelay-shared";
import type { OnChainDeal } from "../chain";
import { errorFields, log } from "../log";
import { repos, type DealDoc } from "../repositories";

/**
 * Keeps the Firestore deal index (status, releaseAt, terminalAt, seekerUid) and the public listing's
 * cached status in step with the chain whenever the server reads a deal. The cron (H11) queries this
 * index for due releases and PII purges; the chain remains the source of truth for every decision.
 */
export async function syncDealIndex(
  dealId: string,
  deal: OnChainDeal,
  extra: { seekerUid?: string } = {},
): Promise<void> {
  try {
    const current = await repos.deals.get(dealId);
    if (!current) return; // not registered through the API
    const status = STATUS_NAMES[deal.status as DealStatus];
    const releaseAt = deal.releaseAt > 0n ? Number(deal.releaseAt) * 1000 : null;
    const now = Date.now();

    const patch: Partial<DealDoc> = {};
    if (current.status !== status) patch.status = status;
    if (current.releaseAt !== releaseAt) patch.releaseAt = releaseAt;
    if (TERMINAL_STATUSES.includes(deal.status as DealStatus) && current.terminalAt === null) {
      patch.terminalAt = now;
    }
    if (extra.seekerUid && current.seekerUid === null) patch.seekerUid = extra.seekerUid;
    if (Object.keys(patch).length === 0) return;

    await repos.deals.update(dealId, { ...patch, updatedAt: now });
    if (patch.status !== undefined || patch.releaseAt !== undefined) {
      await repos.listings
        .update(dealId, { status, releaseAt, updatedAt: now })
        .catch(() => undefined);
    }
    if (deal.status === DealStatus.Cancelled && deal.codeFingerprint !== zeroHash) {
      const vault = await repos.vault.get(deal.codeFingerprint);
      if (vault && vault.dealId === dealId && vault.status === "listed") {
        await repos.vault.update(deal.codeFingerprint, { status: "cancelled" });
      }
    }
  } catch (error) {
    log("warn", "deals.sync_failed", { dealId, ...errorFields(error) });
  }
}
