import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { applyEnv, testEnv } from "../helpers/env";

/** Firestore-backed rate limiter and idempotency store, against the Firestore emulator. */

beforeAll(() => {
  applyEnv(testEnv());
});

describe("FirestoreRateLimiter", () => {
  it("allows the burst, then limits with Retry-After", async () => {
    const { FirestoreRateLimiter } = await import("@/src/server/stores");
    const limiter = new FirestoreRateLimiter();
    const key = `test|uid:${randomUUID()}`;
    const rule = { capacity: 3, refillPerMinute: 1 };
    const decisions = [];
    for (let i = 0; i < 4; i++) decisions.push(await limiter.consume(key, rule));
    expect(decisions.map((decision) => decision.allowed)).toEqual([true, true, true, false]);
    expect(decisions[3].retryAfter).toBeGreaterThan(0);
  });

  it("never grants more than the capacity to concurrent requests", async () => {
    const { FirestoreRateLimiter } = await import("@/src/server/stores");
    const limiter = new FirestoreRateLimiter();
    const key = `test|uid:${randomUUID()}`;
    const rule = { capacity: 2, refillPerMinute: 1 };
    const started = Date.now();
    const decisions = await Promise.all([1, 2, 3].map(() => limiter.consume(key, rule)));
    console.info(`3 concurrent consumes took ${Date.now() - started} ms`);
    expect(decisions.filter((decision) => decision.allowed).length).toBeLessThanOrEqual(2);
  }, 120_000);
});

describe("FirestoreIdempotencyStore", () => {
  it("claims once, replays the stored response and rejects a different payload", async () => {
    const { FirestoreIdempotencyStore } = await import("@/src/server/stores");
    const store = new FirestoreIdempotencyStore();
    const scope = `test|uid:alice|${randomUUID()}`;

    const claims = await Promise.allSettled([store.begin(scope, "h1"), store.begin(scope, "h1")]);
    expect(claims.filter((claim) => claim.status === "fulfilled")).toHaveLength(1);
    const rejected = claims.find((claim) => claim.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "CONFLICT" });

    await store.complete(scope, { status: 201, body: '{"ok":true,"data":1}' });
    expect(await store.begin(scope, "h1")).toEqual({
      state: "replay",
      response: { status: 201, body: '{"ok":true,"data":1}' },
    });
    await expect(store.begin(scope, "h2")).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("releases an abandoned claim", async () => {
    const { FirestoreIdempotencyStore } = await import("@/src/server/stores");
    const store = new FirestoreIdempotencyStore();
    const scope = `test|uid:bob|${randomUUID()}`;
    expect(await store.begin(scope, "h")).toEqual({ state: "new" });
    await store.abandon(scope);
    expect(await store.begin(scope, "h")).toEqual({ state: "new" });
  });
});
