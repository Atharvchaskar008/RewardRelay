import "server-only";
import { withDeadline } from "../deadline";
import { db } from "../firebaseAdmin";

/**
 * A Firestore lease: at most one holder per name until the lease expires, so overlapping cron runs
 * (cron-job.org retries, a manual call, two regions) never work on the same deals at once. A crashed
 * holder's lease simply expires.
 */
export async function acquireLease(name: string, holder: string, ttlMs: number): Promise<boolean> {
  const ref = db().doc(`locks/${name}`);
  const claim = db().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const now = Date.now();
    const current = snapshot.data() as { holder: string; expiresAt: number } | undefined;
    if (current && current.expiresAt > now && current.holder !== holder) return false;
    tx.set(ref, { holder, acquiredAt: now, expiresAt: now + ttlMs });
    return true;
  });
  return withDeadline(claim, undefined, "firestore.lease acquire");
}

export async function releaseLease(name: string, holder: string): Promise<void> {
  const ref = db().doc(`locks/${name}`);
  const release = db().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (snapshot.get("holder") === holder) tx.delete(ref);
  });
  await withDeadline(release, undefined, "firestore.lease release");
}
