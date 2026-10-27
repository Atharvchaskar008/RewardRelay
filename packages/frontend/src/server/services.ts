import "server-only";
import { AppError } from "./errors";
import { serverEnv } from "./env";

/**
 * The pluggable dependencies of the route wrapper. Production uses Firebase Auth and Firestore;
 * unit tests swap in the in-memory implementations below with `setRouteServicesForTests`.
 */

export interface AuthUser {
  uid: string;
  /** E.164 phone number from the verified ID token (phone sign-in), if any. */
  phoneNumber: string | null;
  claims: Record<string, unknown>;
}

export interface RateLimitRule {
  /** Bucket size: the burst a caller may send at once. */
  capacity: number;
  /** Tokens added per minute (sustained rate). */
  refillPerMinute: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds until one token is available (0 when allowed). */
  retryAfter: number;
}

export interface RateLimiter {
  consume(key: string, rule: RateLimitRule): Promise<RateLimitDecision>;
}

export interface StoredResponse {
  status: number;
  body: string;
}

export type IdempotencyBegin = { state: "new" } | { state: "replay"; response: StoredResponse };

export interface IdempotencyStore {
  /** Claims `scope` for this request, or returns the stored response of a completed identical one. */
  begin(scope: string, requestHash: string): Promise<IdempotencyBegin>;
  complete(scope: string, response: StoredResponse): Promise<void>;
  /** Releases a claim after a failed request so the client can retry with the same key. */
  abandon(scope: string): Promise<void>;
}

export interface RouteServices {
  verifyIdToken(token: string): Promise<AuthUser>;
  isAdmin(uid: string): boolean;
  rateLimiter: RateLimiter;
  idempotency: IdempotencyStore;
}

/** Token-bucket arithmetic shared by every rate limiter. */
export function takeToken(
  state: { tokens: number; updatedAt: number } | undefined,
  rule: RateLimitRule,
  now: number,
): { tokens: number; decision: RateLimitDecision } {
  const perMs = rule.refillPerMinute / 60_000;
  const tokens = state
    ? Math.min(rule.capacity, state.tokens + Math.max(0, now - state.updatedAt) * perMs)
    : rule.capacity;
  if (tokens >= 1) return { tokens: tokens - 1, decision: { allowed: true, retryAfter: 0 } };
  return {
    tokens,
    decision: { allowed: false, retryAfter: Math.max(1, Math.ceil((1 - tokens) / perMs / 1000)) },
  };
}

/** A stale "pending" claim (crashed request) may be taken over after this long. */
export const IDEMPOTENCY_PENDING_TTL_MS = 2 * 60_000;
/** Completed responses are replayed for this long. */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60_000;

export class MemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; updatedAt: number }>();
  constructor(private readonly now: () => number = Date.now) {}

  async consume(key: string, rule: RateLimitRule): Promise<RateLimitDecision> {
    const at = this.now();
    const { tokens, decision } = takeToken(this.buckets.get(key), rule, at);
    this.buckets.set(key, { tokens, updatedAt: at });
    return decision;
  }
}

export class MemoryIdempotencyStore implements IdempotencyStore {
  private readonly records = new Map<
    string,
    { requestHash: string; createdAt: number; response?: StoredResponse }
  >();

  async begin(scope: string, requestHash: string): Promise<IdempotencyBegin> {
    const record = this.records.get(scope);
    if (record?.response) {
      if (record.requestHash !== requestHash) throw idempotencyMismatch();
      return { state: "replay", response: record.response };
    }
    if (record && Date.now() - record.createdAt < IDEMPOTENCY_PENDING_TTL_MS)
      throw idempotencyBusy();
    this.records.set(scope, { requestHash, createdAt: Date.now() });
    return { state: "new" };
  }

  async complete(scope: string, response: StoredResponse): Promise<void> {
    const record = this.records.get(scope);
    if (record) record.response = response;
  }

  async abandon(scope: string): Promise<void> {
    this.records.delete(scope);
  }
}

export const idempotencyMismatch = () =>
  new AppError("CONFLICT", {
    message: "This Idempotency-Key was already used for a different request.",
  });

export const idempotencyBusy = () =>
  new AppError("CONFLICT", { message: "The same request is still being processed." });

/** Placeholder until the Firebase-backed services are wired in: tokens are rejected. */
function createDefaultServices(): RouteServices {
  return {
    async verifyIdToken() {
      throw new AppError("AUTH_REQUIRED", { message: "No identity provider is configured." });
    },
    isAdmin: (uid) => serverEnv().ADMIN_UIDS.includes(uid),
    rateLimiter: new MemoryRateLimiter(),
    idempotency: new MemoryIdempotencyStore(),
  };
}

let services: RouteServices | undefined;

export function routeServices(): RouteServices {
  services ??= createDefaultServices();
  return services;
}

/** Test hook: replace (or with no argument, reset) the services used by `withRoute`. */
export function setRouteServicesForTests(replacement?: RouteServices): void {
  services = replacement;
}
