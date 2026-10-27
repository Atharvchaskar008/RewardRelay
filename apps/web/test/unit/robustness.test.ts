import { afterAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { afterResponse } from "@/server/background";
import { TtlCache } from "@/server/cache";
import { DeadlineExceeded, withDeadline } from "@/server/deadline";
import { AppError } from "@/server/errors";
import { withRoute } from "@/server/http";
import { retrying } from "@/server/retry";
import {
  MemoryIdempotencyStore,
  MemoryRateLimiter,
  RevocationCache,
  setRouteServicesForTests,
  type AuthUser,
  type RateLimitRule,
} from "@/server/services";
import {
  markPhase,
  runWithTiming,
  serverTimingHeader,
  timingSummary,
  track,
} from "@/server/timing";

const silence = (["log", "warn", "error"] as const).map((method) =>
  vi.spyOn(console, method).mockImplementation(() => undefined),
);
afterAll(() => silence.forEach((spy) => spy.mockRestore()));

/** A promise that settles when the test says so. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("TtlCache", () => {
  it("shares one in-flight load between concurrent callers and reuses the value until it expires", async () => {
    let now = 1_000;
    const cache = new TtlCache<number>({ ttlMs: 100, max: 10, now: () => now });
    let loads = 0;
    const load = async () => ++loads;
    expect(await Promise.all([cache.get("k", load), cache.get("k", load)])).toEqual([1, 1]);
    expect(await cache.get("k", load)).toBe(1);
    now += 101;
    expect(await cache.get("k", load)).toBe(2);
    expect(loads).toBe(2);
  });

  it("never caches a failure", async () => {
    const cache = new TtlCache<string>({ ttlMs: 1_000, max: 10 });
    await expect(cache.get("k", async () => Promise.reject(new Error("rpc down")))).rejects.toThrow(
      "rpc down",
    );
    expect(await cache.get("k", async () => "ok")).toBe("ok");
  });

  it("does not let a load that started before an invalidation store its stale value", async () => {
    const cache = new TtlCache<string>({ ttlMs: 60_000, max: 10 });
    const slow = deferred<string>();
    const stale = cache.get("k", () => slow.promise);
    cache.invalidate("k");
    slow.resolve("stale");
    expect(await stale).toBe("stale");
    expect(await cache.get("k", async () => "fresh")).toBe("fresh");
  });

  it("refresh never joins an earlier in-flight load", async () => {
    const cache = new TtlCache<string>({ ttlMs: 60_000, max: 10 });
    const slow = deferred<string>();
    void cache.get("k", () => slow.promise);
    expect(await cache.refresh("k", async () => "fresh")).toBe("fresh");
    slow.resolve("stale");
    expect(await cache.get("k", async () => "unused")).toBe("fresh");
  });

  it("drops the oldest entries beyond its size limit", async () => {
    const cache = new TtlCache<number>({ ttlMs: 60_000, max: 2 });
    for (const key of ["a", "b", "c"]) await cache.get(key, async () => 1);
    expect(cache.size).toBe(2);
    let reloaded = false;
    await cache.get("a", async () => {
      reloaded = true;
      return 1;
    });
    expect(reloaded).toBe(true);
  });
});

describe("MemoryRateLimiter", () => {
  it("prunes buckets that have refilled, so memory follows active callers only", async () => {
    let now = 0;
    const limiter = new MemoryRateLimiter(() => now, 10);
    const rule: RateLimitRule = { capacity: 2, refillPerMinute: 60 };
    for (let i = 0; i < 9; i++) await limiter.consume(`ip:${i}`, rule);
    expect(limiter.size).toBe(9);
    now += 60_000;
    await limiter.consume("ip:new", rule); // the 10th call prunes the refilled buckets
    expect(limiter.size).toBe(1);
  });

  it("keeps a bucket that is still refilling, so pruning never resets a limit early", async () => {
    let now = 0;
    const limiter = new MemoryRateLimiter(() => now, 3);
    const rule: RateLimitRule = { capacity: 1, refillPerMinute: 1 };
    expect((await limiter.consume("caller", rule)).allowed).toBe(true);
    now += 10_000;
    await limiter.consume("other-1", rule);
    await limiter.consume("other-2", rule); // prune runs here; "caller" is not full yet
    expect((await limiter.consume("caller", rule)).allowed).toBe(false);
  });
});

describe("RevocationCache", () => {
  const SECOND = 1_000;
  it("looks a user up once per minute and applies Firebase's revocation rule", async () => {
    let now = 100 * SECOND;
    let record = { disabled: false, tokensValidAfterTime: new Date(50 * SECOND).toUTCString() };
    let lookups = 0;
    const cache = new RevocationCache(
      async () => {
        lookups++;
        return record;
      },
      { now: () => now },
    );

    await cache.assertActive("uid", 60); // issued after tokensValidAfterTime: valid
    await cache.assertActive("uid", 60);
    expect(lookups).toBe(1);
    await expect(cache.assertActive("uid", 40)).rejects.toThrow("auth/id-token-revoked");

    // Revoked now: a read may rely on the earlier check for up to a minute, then sees it.
    record = { disabled: false, tokensValidAfterTime: new Date(100 * SECOND).toUTCString() };
    await cache.assertActive("uid", 60);
    now += 61 * SECOND;
    await expect(cache.assertActive("uid", 60)).rejects.toThrow("auth/id-token-revoked");
    expect(lookups).toBe(2);
  });

  it("refuses a disabled account and stays bounded", async () => {
    const cache = new RevocationCache(async () => ({ disabled: true }), { max: 2 });
    await expect(cache.assertActive("a", 1)).rejects.toThrow("auth/user-disabled");
    const active = new RevocationCache(async () => ({ disabled: false }), { max: 2 });
    for (const uid of ["a", "b", "c"]) await active.assertActive(uid, 1);
  });
});

describe("request timing", () => {
  it("records phases and per-backend busy time, and formats a Server-Timing header", async () => {
    await runWithTiming(async () => {
      markPhase("auth");
      await track("db", Promise.resolve(1));
      await track("chain", Promise.resolve(2));
      await track("chain", Promise.resolve(3));
      await expect(track("db", Promise.reject(new Error("x")))).rejects.toThrow("x");
      markPhase("app");
      const header = serverTimingHeader(42)!;
      expect(header).toMatch(/^auth;dur=\d+, app;dur=\d+, db;dur=\d+;desc="2 calls", /);
      expect(header).toContain("chain;dur=");
      expect(header).toContain('desc="2 calls"');
      expect(header.endsWith("total;dur=42")).toBe(true);
      expect(timingSummary()).toMatchObject({ dbCalls: 2, chainCalls: 2 });
    });
  });

  it("is a no-op outside a request", async () => {
    expect(await track("db", Promise.resolve(7))).toBe(7);
    markPhase("ignored");
    expect(serverTimingHeader(1)).toBeUndefined();
    expect(timingSummary()).toBeUndefined();
  });
});

describe("withDeadline", () => {
  it("fails fast with a user-safe error that names the slow operation for the logs", async () => {
    const error = await withDeadline(new Promise(() => undefined), 10, "firestore.get users").catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("INTERNAL");
    const cause = (error as AppError).cause as DeadlineExceeded;
    expect(cause).toBeInstanceOf(DeadlineExceeded);
    expect(cause.operation).toBe("firestore.get users");
    expect(cause.message).toBe("firestore.get users did not answer within 10 ms");
  });

  it("passes a fast result through", async () => {
    expect(await withDeadline(Promise.resolve("ok"), 1_000, "fast")).toBe("ok");
  });
});

describe("retrying", () => {
  it("retries an idempotent call until it succeeds", async () => {
    let attempts = 0;
    const result = await retrying(
      async () => {
        if (++attempts < 3) throw new Error("transient");
        return "done";
      },
      { baseDelayMs: 1 },
    );
    expect(result).toBe("done");
    expect(attempts).toBe(3);
  });

  it("gives up after the last attempt with the last error", async () => {
    let attempts = 0;
    await expect(
      retrying(
        async () => {
          attempts++;
          throw new Error(`failure ${attempts}`);
        },
        { attempts: 2, baseDelayMs: 1 },
      ),
    ).rejects.toThrow("failure 2");
  });
});

describe("afterResponse", () => {
  it("runs the task inline outside a Next request and never throws", async () => {
    let ran = false;
    await afterResponse("test.task", async () => {
      ran = true;
    });
    expect(ran).toBe(true);
    await expect(
      afterResponse("test.failing", async () => {
        throw new Error("background failure");
      }),
    ).resolves.toBeUndefined();
  });
});

describe("withRoute read and write checks", () => {
  const USER: AuthUser = { uid: "uid-reader", phoneNumber: "+919000000009", claims: {} };
  const verifications: boolean[] = [];
  const used: string[] = [];
  const limiter = (name: string) => ({
    async consume() {
      used.push(name);
      return { allowed: true, retryAfter: 0 };
    },
  });
  setRouteServicesForTests({
    async verifyIdToken(_token, options) {
      verifications.push(options?.strict ?? true);
      return USER;
    },
    isAdmin: () => false,
    rateLimiter: limiter("shared"),
    readRateLimiter: limiter("instance"),
    idempotency: new MemoryIdempotencyStore(),
  });

  const run = async (method: string, strict?: boolean) => {
    const handler = withRoute({ name: "test.checks", strict }, async () => ({ ok: true }));
    return handler(
      new NextRequest("http://localhost/api/test", {
        method,
        headers: { authorization: "Bearer token" },
      }),
      { params: Promise.resolve({}) },
    );
  };

  it("uses the light checks for a plain read and the strict ones for writes and private reads", async () => {
    const read = await run("GET");
    expect(read.status).toBe(200);
    expect(read.headers.get("server-timing")).toMatch(/auth;dur=\d+, limit;dur=\d+, app;dur=\d+/);
    await run("POST");
    await run("GET", true);
    expect(verifications).toEqual([false, true, true]);
    expect(used).toEqual(["instance", "shared", "shared"]);
  });
});
