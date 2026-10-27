import { afterAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { AppError } from "@/src/server/errors";
import { withRoute } from "@/src/server/http";
import {
  MemoryIdempotencyStore,
  MemoryRateLimiter,
  setRouteServicesForTests,
} from "@/src/server/services";
import { withDeadline } from "@/src/server/deadline";

const silence = (["log", "warn", "error"] as const).map((method) =>
  vi.spyOn(console, method).mockImplementation(() => undefined),
);
afterAll(() => silence.forEach((spy) => spy.mockRestore()));

describe("withDeadline", () => {
  it("passes a fast result through", async () => {
    await expect(withDeadline(Promise.resolve(42), 50)).resolves.toBe(42);
  });

  it("fails a hung call fast with a user-safe INTERNAL error", async () => {
    const started = Date.now();
    const error = await withDeadline(new Promise(() => undefined), 50).catch(
      (caught: unknown) => caught,
    );
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("INTERNAL");
    expect((error as AppError).message).toMatch(/temporarily unavailable/);
  });
});

describe("withRoute during an outage", () => {
  it("reports a token-verification outage as 500, not as an expired session", async () => {
    setRouteServicesForTests({
      verifyIdToken: () => withDeadline(new Promise(() => undefined), 20),
      isAdmin: () => false,
      rateLimiter: new MemoryRateLimiter(),
      idempotency: new MemoryIdempotencyStore(),
    });
    const route = withRoute({ name: "test.outage" }, async () => "never");
    const res = await route(
      new NextRequest("http://localhost/api/x", { headers: { authorization: "Bearer token-123" } }),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("INTERNAL");
    setRouteServicesForTests(undefined);
  });

  it("accepts Next 15 promise params", async () => {
    setRouteServicesForTests({
      verifyIdToken: async () => ({ uid: "u", phoneNumber: null, claims: {} }),
      isAdmin: () => false,
      rateLimiter: new MemoryRateLimiter(),
      idempotency: new MemoryIdempotencyStore(),
    });
    const route = withRoute({ name: "test.params", auth: "none" }, async ({ params }) => params.id);
    const res = await route(new NextRequest("http://localhost/api/x/7"), {
      params: Promise.resolve({ id: "7" }),
    });
    expect(await res.json()).toEqual({ ok: true, data: "7" });
    setRouteServicesForTests(undefined);
  });
});

describe("idempotent completion failure", () => {
  it("returns the handler's success and never re-runs it on a retry", async () => {
    class FlakyStore extends MemoryIdempotencyStore {
      override async complete(): Promise<void> {
        throw new Error("Firestore write failed");
      }
    }
    setRouteServicesForTests({
      verifyIdToken: async () => ({ uid: "u1", phoneNumber: null, claims: {} }),
      isAdmin: () => false,
      rateLimiter: new MemoryRateLimiter(),
      idempotency: new FlakyStore(),
    });
    let runs = 0;
    const route = withRoute({ name: "test.flaky-store", idempotent: true }, async () => ++runs);
    const request = () =>
      new NextRequest("http://localhost/api/x", {
        method: "POST",
        headers: { authorization: "Bearer t", "idempotency-key": "same-key-0001" },
      });
    const first = await route(request(), { params: Promise.resolve({}) });
    expect(first.status).toBe(200);
    const retry = await route(request(), { params: Promise.resolve({}) });
    expect(retry.status).toBe(409); // still "pending": refused, not executed twice
    expect(runs).toBe(1);
    setRouteServicesForTests(undefined);
  });
});
