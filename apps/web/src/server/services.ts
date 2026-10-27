import "server-only";
import { AppError } from "./errors";
import { serverEnv } from "./env";
import { adminAuth } from "./firebaseAdmin";
import { withDeadline } from "./deadline";
import { FirestoreIdempotencyStore, FirestoreRateLimiter } from "./stores";
import { track } from "./timing";

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
  /**
   * Verifies a Firebase ID token. `strict` (writes and private reads) checks revocation and disabled
   * accounts on every call; otherwise that check is reused for up to REVOCATION_CHECK_TTL_MS.
   */
  verifyIdToken(token: string, options?: { strict?: boolean }): Promise<AuthUser>;
  isAdmin(uid: string): boolean;
  /** Shared across instances: writes and private reads. */
  rateLimiter: RateLimiter;
  /** Per instance, for reads without private data; `rateLimiter` when absent. */
  readRateLimiter?: RateLimiter;
  idempotency: IdempotencyStore;
}

/** How long a light read may rely on an earlier revocation / disabled-account check of the same user. */
export const REVOCATION_CHECK_TTL_MS = 60_000;

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
  /** `fullAt`: when the bucket is full again, i.e. indistinguishable from a missing one. */
  private readonly buckets = new Map<
    string,
    { tokens: number; updatedAt: number; fullAt: number }
  >();
  private consumed = 0;
  constructor(
    private readonly now: () => number = Date.now,
    /** Full buckets are dropped every `pruneEvery` calls, so memory stays bounded by active callers. */
    private readonly pruneEvery = 1_000,
  ) {}

  async consume(key: string, rule: RateLimitRule): Promise<RateLimitDecision> {
    const at = this.now();
    if (++this.consumed % this.pruneEvery === 0) this.prune(at);
    const { tokens, decision } = takeToken(this.buckets.get(key), rule, at);
    const fullAt = at + Math.ceil(((rule.capacity - tokens) / rule.refillPerMinute) * 60_000);
    this.buckets.set(key, { tokens, updatedAt: at, fullAt });
    return decision;
  }

  /** Number of tracked buckets (for tests and diagnostics). */
  get size(): number {
    return this.buckets.size;
  }

  private prune(at: number): void {
    for (const [key, bucket] of this.buckets) if (bucket.fullAt <= at) this.buckets.delete(key);
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

/** What the revocation check needs from Firebase Auth's user record. */
export interface RevocationRecord {
  tokensValidAfterTime?: string;
  disabled: boolean;
}

/**
 * Revocation state per user for light reads: the same rule Firebase applies with `checkRevoked`
 * (a token issued before `tokensValidAfterTime`, or a disabled account, is rejected), with the user
 * record looked up at most once per `ttlMs`. Bounded so a flood of users cannot grow it without
 * limit.
 */
export class RevocationCache {
  private readonly states = new Map<
    string,
    { checkedAt: number; validSince: number; disabled: boolean }
  >();

  constructor(
    private readonly lookup: (uid: string) => Promise<RevocationRecord>,
    private readonly options: { ttlMs?: number; max?: number; now?: () => number } = {},
  ) {}

  /** Throws when the token (issued at `authTimeSeconds`) was revoked or the account is disabled. */
  async assertActive(uid: string, authTimeSeconds: number): Promise<void> {
    const now = (this.options.now ?? Date.now)();
    let state = this.states.get(uid);
    if (!state || now - state.checkedAt > (this.options.ttlMs ?? REVOCATION_CHECK_TTL_MS)) {
      const record = await this.lookup(uid);
      state = {
        checkedAt: now,
        validSince: record.tokensValidAfterTime
          ? new Date(record.tokensValidAfterTime).getTime()
          : 0,
        disabled: record.disabled,
      };
      if (this.states.size >= (this.options.max ?? 10_000)) this.states.clear();
      this.states.set(uid, state);
    }
    if (state.disabled) throw new Error("auth/user-disabled");
    if (authTimeSeconds * 1000 < state.validSince) throw new Error("auth/id-token-revoked");
  }
}

function createDefaultServices(): RouteServices {
  const revocations = new RevocationCache((uid) =>
    withDeadline(track("identity", adminAuth().getUser(uid)), undefined, "auth.getUser"),
  );
  return {
    async verifyIdToken(token, options = {}) {
      const strict = options.strict ?? true;
      // Strict: Firebase checks revocation itself (one Auth call). Light: the signature and expiry
      // are checked locally with cached keys, and revocation through the per-user cache.
      const decoded = await withDeadline(
        track("identity", adminAuth().verifyIdToken(token, strict)),
        undefined,
        "auth.verifyIdToken",
      );
      if (!strict) await revocations.assertActive(decoded.uid, decoded.auth_time);
      return {
        uid: decoded.uid,
        phoneNumber: decoded.phone_number ?? null,
        claims: decoded as unknown as Record<string, unknown>,
      };
    },
    isAdmin: (uid) => serverEnv().ADMIN_UIDS.includes(uid),
    rateLimiter: new FirestoreRateLimiter(),
    readRateLimiter: new MemoryRateLimiter(),
    idempotency: new FirestoreIdempotencyStore(),
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
