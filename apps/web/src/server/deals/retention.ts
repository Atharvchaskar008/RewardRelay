import "server-only";
import { db } from "../firebaseAdmin";
import { errorFields, log } from "../log";
import { repos } from "../repositories";
import { transaction } from "../repositories/collection";
import { storeFor } from "../files/store";
import { proofDocSchema } from "./proof";
import { privateDocs } from "./privateDocs";

export const PII_RETENTION_MS = 7 * 24 * 60 * 60_000;

/**
 * Deletes delivery details, proofs and files of deals that reached a terminal status more than
 * 7 days ago, and marks them purged. Bounded per run; called by the cron route (H11).
 */
export async function purgeExpiredPrivateData(
  options: { now?: number; limit?: number; retentionMs?: number } = {},
): Promise<string[]> {
  const cutoff = (options.now ?? Date.now()) - (options.retentionMs ?? PII_RETENTION_MS);
  const due = await repos.deals
    .query()
    .where("piiPurgedAt", "==", null)
    .where("terminalAt", "<=", cutoff)
    .limit(options.limit ?? 25)
    .get();
  const purged: string[] = [];
  for (const snapshot of due.docs) {
    const dealId = snapshot.id;
    try {
      const proof = await privateDocs(dealId, proofDocSchema).get("proof");
      if (proof?.invoice?.backend === "blob")
        await storeFor(proof.invoice).delete(`deals/${dealId}`, proof.invoice);
      await db().recursiveDelete(db().collection(`deals/${dealId}/private`));
      await db().recursiveDelete(db().collection(`deals/${dealId}/files`));
      await transaction(async (tx) => {
        await repos.deals.update(dealId, { piiPurgedAt: Date.now(), updatedAt: Date.now() }, tx);
      });
      purged.push(dealId);
    } catch (error) {
      log("error", "pii.purge_failed", { dealId, ...errorFields(error) });
    }
  }
  return purged;
}
