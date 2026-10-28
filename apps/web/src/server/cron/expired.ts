import "server-only";
import { withDeadline } from "../deadline";
import { db } from "../firebaseAdmin";
import { repos } from "../repositories";
import { runQuery } from "../repositories/collection";
import { track } from "../timing";

/** Short-lived request records; every reader already treats an expired one as absent. */
const EXPIRING = [repos.idempotency, repos.rateLimits, repos.challenges].map((repo) => repo.name);

/**
 * Deletes idempotency keys, rate-limit buckets and wallet-link challenges whose `expiresAt` has
 * passed, at most `limit` per collection per run. The keeper does this because a Firestore TTL policy
 * needs a project with billing enabled.
 */
export async function purgeExpiredRecords(
  options: { now?: number; limit?: number } = {},
): Promise<number> {
  const cutoff = new Date(options.now ?? Date.now());
  let deleted = 0;
  for (const name of EXPIRING) {
    // Without a converter and with no fields selected: a malformed record is still deleted.
    const due = await runQuery(
      db()
        .collection(name)
        .where("expiresAt", "<=", cutoff)
        .select()
        .limit(options.limit ?? 200),
      `firestore.query expired ${name}`,
    );
    if (due.empty) continue;
    const batch = db().batch();
    due.docs.forEach((doc) => batch.delete(doc.ref));
    await withDeadline(track("db", batch.commit()), undefined, `firestore.delete expired ${name}`);
    deleted += due.size;
  }
  return deleted;
}
