import "server-only";
import { createHash } from "crypto";
import { repos } from "./repositories";
import { transaction } from "./repositories/collection";
import {
  IDEMPOTENCY_PENDING_TTL_MS,
  IDEMPOTENCY_TTL_MS,
  idempotencyBusy,
  idempotencyMismatch,
  takeToken,
  type IdempotencyBegin,
  type IdempotencyStore,
  type RateLimitDecision,
  type RateLimitRule,
  type RateLimiter,
  type StoredResponse,
} from "./services";

/** Document ids are hashes, so uids and keys never appear as Firestore paths. */
const docId = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

/** Token bucket in Firestore, updated in a transaction (correct across serverless instances). */
export class FirestoreRateLimiter implements RateLimiter {
  async consume(key: string, rule: RateLimitRule): Promise<RateLimitDecision> {
    const id = docId(key);
    return transaction(async (tx) => {
      const now = Date.now();
      const current = await repos.rateLimits.get(id, tx);
      const { tokens, decision } = takeToken(current, rule, now);
      // A full bucket refills in capacity / rate minutes; keep the doc a little longer than that.
      const ttlMs = Math.ceil((rule.capacity / rule.refillPerMinute) * 60_000) + 60_000;
      await repos.rateLimits.set(
        id,
        { tokens, updatedAt: now, expiresAt: new Date(now + ttlMs) },
        tx,
      );
      return decision;
    });
  }
}

export class FirestoreIdempotencyStore implements IdempotencyStore {
  async begin(scope: string, requestHash: string): Promise<IdempotencyBegin> {
    const id = docId(scope);
    return transaction(async (tx) => {
      const now = Date.now();
      const record = await repos.idempotency.get(id, tx);
      if (record?.state === "done") {
        if (record.requestHash !== requestHash) throw idempotencyMismatch();
        return {
          state: "replay",
          response: { status: record.status ?? 200, body: record.body ?? "" },
        } as const;
      }
      if (record && now - record.createdAt < IDEMPOTENCY_PENDING_TTL_MS) {
        if (record.requestHash !== requestHash) throw idempotencyMismatch();
        throw idempotencyBusy();
      }
      await repos.idempotency.set(
        id,
        {
          state: "pending",
          requestHash,
          createdAt: now,
          expiresAt: new Date(now + IDEMPOTENCY_TTL_MS),
        },
        tx,
      );
      return { state: "new" } as const;
    });
  }

  async complete(scope: string, response: StoredResponse): Promise<void> {
    await repos.idempotency.update(docId(scope), {
      state: "done",
      status: response.status,
      body: response.body,
    });
  }

  async abandon(scope: string): Promise<void> {
    await repos.idempotency.delete(docId(scope));
  }
}
