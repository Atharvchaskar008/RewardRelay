import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { z } from "zod";
import { AppError, ERROR_CATALOGUE, toAppError } from "@/server/errors";
import { respond, withRoute } from "@/server/http";
import {
  MemoryIdempotencyStore,
  MemoryRateLimiter,
  setRouteServicesForTests,
  takeToken,
  type AuthUser,
} from "@/server/services";

const VALID_TOKEN = "valid-id-token-for-tests";
const ALICE: AuthUser = { uid: "uid-alice", phoneNumber: "+16505550101", claims: {} };

function useServices() {
  setRouteServicesForTests({
    async verifyIdToken(token) {
      if (token === VALID_TOKEN) return ALICE;
      if (token === "admin-token") return { uid: "uid-admin", phoneNumber: null, claims: {} };
      throw new Error("Firebase ID token has invalid signature");
    },
    isAdmin: (uid) => uid === "uid-admin",
    rateLimiter: new MemoryRateLimiter(),
    idempotency: new MemoryIdempotencyStore(),
  });
}

function request(
  method: string,
  init: { token?: string; body?: unknown; headers?: Record<string, string>; url?: string } = {},
) {
  const headers: Record<string, string> = { ...init.headers };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(init.url ?? "http://localhost/api/test", {
    method,
    headers,
    body:
      init.body === undefined
        ? undefined
        : typeof init.body === "string"
          ? init.body
          : JSON.stringify(init.body),
  });
}

async function call(handler: ReturnType<typeof withRoute>, req: NextRequest, params = {}) {
  const res = await handler(req, { params: Promise.resolve(params) });
  return { res, json: await res.json() };
}

describe("error catalogue", () => {
  it("maps every code to a status and a user-safe message", () => {
    for (const [code, entry] of Object.entries(ERROR_CATALOGUE)) {
      const error = new AppError(code as keyof typeof ERROR_CATALOGUE);
      expect(error.status).toBe(entry.status);
      expect(error.message).toBe(entry.message);
    }
    expect(new AppError("CHAIN_STATE_MISMATCH").status).toBe(409);
    expect(new AppError("VAULT_LOCKED").status).toBe(423);
  });

  it("maps zod errors to VALIDATION_FAILED with paths and unknown errors to INTERNAL", () => {
    const zod = z.object({ price: z.number() }).safeParse({ price: "x" });
    const mapped = toAppError(zod.error);
    expect(mapped.code).toBe("VALIDATION_FAILED");
    expect(mapped.details).toEqual({ issues: [{ path: "price", message: expect.any(String) }] });
    const internal = toAppError(new Error("db password=hunter2 leaked in message"));
    expect(internal.code).toBe("INTERNAL");
    expect(internal.message).toBe(ERROR_CATALOGUE.INTERNAL.message);
  });
});

describe("withRoute", () => {
  const logs: string[] = [];
  const spies = (["log", "warn", "error"] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      logs.push(String(args[0]));
    }),
  );
  afterAll(() => spies.forEach((spy) => spy.mockRestore()));
  beforeEach(() => {
    logs.length = 0;
    useServices();
  });

  const echo = withRoute(
    {
      name: "test.echo",
      body: z.object({ amount: z.number().int().positive(), note: z.string().max(20) }),
    },
    async ({ body, user, requestId }) => ({
      amount: body.amount,
      uid: user?.uid,
      requestId,
      big: 5n,
    }),
  );

  it("returns the success envelope with no-store and a request id", async () => {
    const { res, json } = await call(
      echo,
      request("POST", { token: VALID_TOKEN, body: { amount: 2, note: "hi" } }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-request-id")).toBe(json.data.requestId);
    expect(json).toEqual({
      ok: true,
      data: { amount: 2, uid: "uid-alice", requestId: expect.any(String), big: "5" },
    });
  });

  it("requires a valid Firebase ID token", async () => {
    const missing = await call(echo, request("POST", { body: { amount: 1, note: "" } }));
    expect(missing.res.status).toBe(401);
    expect(missing.json.error).toMatchObject({
      code: "AUTH_REQUIRED",
      requestId: expect.any(String),
    });
    const bad = await call(
      echo,
      request("POST", { token: "forged", body: { amount: 1, note: "" } }),
    );
    expect(bad.res.status).toBe(401);
    expect(bad.json.ok).toBe(false);
  });

  it("rejects invalid bodies with VALIDATION_FAILED and field paths", async () => {
    const { res, json } = await call(
      echo,
      request("POST", { token: VALID_TOKEN, body: { amount: -1, note: "x" } }),
    );
    expect(res.status).toBe(400);
    expect(json.error.code).toBe("VALIDATION_FAILED");
    expect(json.error.details.issues[0].path).toBe("amount");
    const notJson = await call(echo, request("POST", { token: VALID_TOKEN, body: "{nope" }));
    expect(notJson.json.error.message).toMatch(/must be JSON/);
  });

  it("maps thrown AppErrors to their status and hides unknown errors", async () => {
    const mismatch = withRoute({ name: "test.mismatch", auth: "none" }, async () => {
      throw new AppError("CHAIN_STATE_MISMATCH", { details: { status: "Listed" } });
    });
    const a = await call(mismatch, request("GET"));
    expect(a.res.status).toBe(409);
    expect(a.json.error).toMatchObject({
      code: "CHAIN_STATE_MISMATCH",
      details: { status: "Listed" },
    });

    const crash = withRoute({ name: "test.crash", auth: "none" }, async () => {
      throw new Error(`internal detail ${VALID_TOKEN}`);
    });
    const b = await call(crash, request("GET"));
    expect(b.res.status).toBe(500);
    expect(b.json.error.code).toBe("INTERNAL");
    expect(JSON.stringify(b.json)).not.toContain("internal detail");
  });

  it("restricts admin routes to ADMIN_UIDS", async () => {
    const admin = withRoute({ name: "test.admin", admin: true }, async () => "ok");
    expect((await call(admin, request("GET", { token: VALID_TOKEN }))).res.status).toBe(403);
    expect((await call(admin, request("GET", { token: "admin-token" }))).json).toEqual({
      ok: true,
      data: "ok",
    });
  });

  it("rate-limits per user with Retry-After", async () => {
    const limited = withRoute(
      { name: "test.limited", rateLimit: { capacity: 2, refillPerMinute: 1 } },
      async () => 1,
    );
    expect((await call(limited, request("GET", { token: VALID_TOKEN }))).res.status).toBe(200);
    expect((await call(limited, request("GET", { token: VALID_TOKEN }))).res.status).toBe(200);
    const third = await call(limited, request("GET", { token: VALID_TOKEN }));
    expect(third.res.status).toBe(429);
    expect(third.json.error.code).toBe("RATE_LIMITED");
    expect(Number(third.res.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("replays idempotent requests and rejects a reused key with another payload", async () => {
    let executions = 0;
    const create = withRoute(
      { name: "test.create", idempotent: true, body: z.object({ title: z.string() }) },
      async ({ body }) => {
        executions++;
        return respond({ id: executions, title: body.title }, { status: 201 });
      },
    );
    const headers = { "idempotency-key": "key-0001-abcdef" };
    const first = await call(
      create,
      request("POST", { token: VALID_TOKEN, headers, body: { title: "A" } }),
    );
    const second = await call(
      create,
      request("POST", { token: VALID_TOKEN, headers, body: { title: "A" } }),
    );
    expect(first.res.status).toBe(201);
    expect(second.res.status).toBe(201);
    expect(second.res.headers.get("idempotent-replayed")).toBe("true");
    expect(second.json).toEqual(first.json);
    expect(executions).toBe(1);

    const conflict = await call(
      create,
      request("POST", { token: VALID_TOKEN, headers, body: { title: "B" } }),
    );
    expect(conflict.res.status).toBe(409);
    const missingKey = await call(
      create,
      request("POST", { token: VALID_TOKEN, body: { title: "A" } }),
    );
    expect(missingKey.json.error.code).toBe("VALIDATION_FAILED");
  });

  it("releases the idempotency key when the handler fails, so a retry runs again", async () => {
    let attempts = 0;
    const flaky = withRoute({ name: "test.flaky", idempotent: true }, async () => {
      attempts++;
      if (attempts === 1) throw new AppError("TX_FAILED");
      return "done";
    });
    const headers = { "idempotency-key": "key-0002-abcdef" };
    expect((await call(flaky, request("POST", { token: VALID_TOKEN, headers }))).res.status).toBe(
      502,
    );
    expect((await call(flaky, request("POST", { token: VALID_TOKEN, headers }))).json.data).toBe(
      "done",
    );
  });

  it("logs structured JSON without tokens, phone numbers or bodies", async () => {
    await call(
      echo,
      request("POST", { token: VALID_TOKEN, body: { amount: 3, note: "private-note" } }),
    );
    await call(
      echo,
      request("POST", { token: "forged-token-value", body: { amount: 3, note: "x" } }),
    );
    expect(logs.length).toBeGreaterThanOrEqual(2);
    for (const line of logs) {
      const entry = JSON.parse(line);
      expect(entry).toMatchObject({ event: "api.request", route: "test.echo" });
      expect(line).not.toContain(VALID_TOKEN);
      expect(line).not.toContain("forged-token-value");
      expect(line).not.toContain("+16505550101");
      expect(line).not.toContain("private-note");
      expect(line).not.toContain("uid-alice");
    }
  });
});

describe("token bucket", () => {
  it("refills at the configured rate up to capacity", () => {
    const rule = { capacity: 3, refillPerMinute: 60 };
    let state = { tokens: 0, updatedAt: 0 };
    const empty = takeToken(state, rule, 0);
    expect(empty.decision).toEqual({ allowed: false, retryAfter: 1 });
    const later = takeToken(state, rule, 1_000);
    expect(later.decision.allowed).toBe(true);
    state = { tokens: later.tokens, updatedAt: 1_000 };
    expect(takeToken(state, rule, 1_000_000).tokens).toBe(2); // capped at capacity, minus one
  });
});
