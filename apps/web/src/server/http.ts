import "server-only";
import { createHash, randomUUID } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import type { z } from "zod";
import { AppError, toAppError } from "./errors";
import { errorFields, log } from "./log";
import { routeServices, type AuthUser, type RateLimitRule } from "./services";
import { markPhase, runWithTiming, serverTimingHeader, timingSummary } from "./timing";

/**
 * The one wrapper every API route goes through:
 * request ID → Firebase ID token → admin check → rate limit → zod validation (query + JSON body)
 * → idempotency → handler → envelope / error mapping → structured log.
 *
 * Reads (GET/HEAD) and writes are checked differently: a write verifies that the session was not
 * revoked on every request and is rate-limited across instances (Firestore); a read reuses a
 * revocation check for up to a minute and is rate-limited per instance (memory).
 *
 * Responses: `{ ok: true, data }` or `{ ok: false, error: { code, message, requestId, details? } }`,
 * always `Cache-Control: no-store`, an `X-Request-Id` header and a `Server-Timing` header.
 */

export type ApiEnvelope<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        requestId: string;
        details?: Record<string, unknown>;
      };
    };

const RESULT = Symbol("route-result");

export interface RouteResult<T> {
  [RESULT]: true;
  data: T;
  status: number;
  headers?: Record<string, string>;
}

/** Return this from a handler to choose the status code or add headers. */
export function respond<T>(
  data: T,
  init: { status?: number; headers?: Record<string, string> } = {},
): RouteResult<T> {
  return { [RESULT]: true, data, status: init.status ?? 200, headers: init.headers };
}

function isRouteResult(value: unknown): value is RouteResult<unknown> {
  return typeof value === "object" && value !== null && RESULT in value;
}

type Schema = z.ZodType | undefined;
type Parsed<S extends Schema> = S extends z.ZodType ? z.output<S> : undefined;

export interface RouteOptions<B extends Schema, Q extends Schema> {
  /** Stable route id for logs, rate-limit and idempotency keys, e.g. "auth.link-wallet". */
  name: string;
  /** Default "required". */
  auth?: "required" | "optional" | "none";
  /** Restrict to ADMIN_UIDS (implies auth and strict). */
  admin?: boolean;
  /**
   * Apply the write-grade checks to a read: revocation checked on every request and the shared
   * (Firestore) rate limit. Use for reads that return private data (details, codes, backups).
   */
  strict?: boolean;
  body?: B;
  query?: Q;
  /** Token bucket per uid (or per IP when anonymous). Default 30 burst / 30 per minute. */
  rateLimit?: RateLimitRule | false;
  /** Require an Idempotency-Key header and replay the stored response for a repeated request. */
  idempotent?: boolean;
  /** Maximum JSON body size in bytes (default 64 KiB). */
  maxBodyBytes?: number;
  /** Cache-Control header (e.g. for CDN / Edge caching on public reads). Default: "no-store". */
  cacheControl?: string;
}

export interface RouteContext<B, Q> {
  req: NextRequest;
  requestId: string;
  user: AuthUser | null;
  body: B;
  query: Q;
  params: Record<string, string>;
  /** Short hash of the caller IP (never the IP itself). */
  ipTag: string;
}

/** Next 15 passes route params as a Promise (a plain object is also tolerated at runtime). */
export type RouteHandler = (
  req: NextRequest,
  context: { params: Promise<Record<string, string>> },
) => Promise<NextResponse>;

const DEFAULT_RATE_LIMIT: RateLimitRule = { capacity: 30, refillPerMinute: 30 };
const DEFAULT_MAX_BODY = 64 * 1024;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,128}$/;
const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

export const shortHash = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);

/** JSON with bigint support (bigints become decimal strings). */
export function toJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner) =>
    typeof inner === "bigint" ? inner.toString() : inner,
  );
}

function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip") || "unknown";
}

function jsonResponse(
  body: string,
  status: number,
  requestId: string,
  headers: Record<string, string> = {},
): NextResponse {
  return new NextResponse(body, {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": headers["Cache-Control"] ?? "no-store",
      "X-Request-Id": requestId,
      ...headers,
    },
  });
}

async function readJsonBody(req: NextRequest, maxBytes: number): Promise<unknown> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) {
    throw new AppError("VALIDATION_FAILED", { message: "The request is too large." });
  }
  const text = await req.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new AppError("VALIDATION_FAILED", { message: "The request is too large." });
  }
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("VALIDATION_FAILED", { message: "The request body must be JSON." });
  }
}

export function withRoute<B extends Schema = undefined, Q extends Schema = undefined, T = unknown>(
  options: RouteOptions<B, Q>,
  handler: (context: RouteContext<Parsed<B>, Parsed<Q>>) => Promise<T | RouteResult<T>>,
): RouteHandler {
  const authMode = options.admin ? "required" : (options.auth ?? "required");

  return (req, context) => runWithTiming(() => handle(req, context));

  async function handle(
    req: NextRequest,
    context: { params: Promise<Record<string, string>> },
  ): Promise<NextResponse> {
    const started = Date.now();
    const headerId = req.headers.get("x-request-id");
    const requestId = headerId && REQUEST_ID.test(headerId) ? headerId : randomUUID();
    const ipTag = shortHash(clientIp(req));
    // Light checks only for reads that return no private data.
    const isRead =
      (req.method === "GET" || req.method === "HEAD") && !options.strict && !options.admin;
    let user: AuthUser | null = null;
    let idempotencyScope: string | undefined;
    const services = routeServices();
    const timingHeaders = (): Record<string, string> => {
      const value = serverTimingHeader(Date.now() - started);
      return value ? { "Server-Timing": value } : {};
    };
    const logRequest = (level: "info" | "error", fields: Record<string, unknown>) =>
      log(level, "api.request", {
        route: options.name,
        requestId,
        uidTag: user ? shortHash(user.uid) : undefined,
        durationMs: Date.now() - started,
        timing: timingSummary(),
        ...fields,
      });

    try {
      const params: Record<string, string> = (await context?.params) ?? {};
      // 1. Authentication (Firebase ID token; revocation checked on every write).
      if (authMode !== "none") {
        const header = req.headers.get("authorization") ?? "";
        const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
        if (token) {
          try {
            user = await services.verifyIdToken(token, { strict: !isRead });
          } catch (error) {
            // An outage (deadline) is not an expired session.
            if (error instanceof AppError && error.code === "INTERNAL") throw error;
            throw new AppError("AUTH_REQUIRED", {
              message: "Your session has expired. Please sign in again.",
              cause: error,
            });
          }
        } else if (authMode === "required") {
          throw new AppError("AUTH_REQUIRED");
        }
        markPhase("auth");
      }
      if (options.admin && (!user || !services.isAdmin(user.uid))) throw new AppError("FORBIDDEN");

      // 2. Rate limit per uid, or per IP for anonymous callers.
      if (options.rateLimit !== false) {
        const rule = options.rateLimit ?? DEFAULT_RATE_LIMIT;
        const subject = user ? `uid:${user.uid}` : `ip:${ipTag}`;
        const limiter = isRead
          ? (services.readRateLimiter ?? services.rateLimiter)
          : services.rateLimiter;
        const decision = await limiter.consume(`${options.name}|${subject}`, rule);
        if (!decision.allowed) {
          throw new AppError("RATE_LIMITED", { retryAfter: decision.retryAfter });
        }
        markPhase("limit");
      }

      // 3. Validation.
      const query = options.query
        ? options.query.parse(Object.fromEntries(req.nextUrl.searchParams.entries()))
        : undefined;
      const body = options.body
        ? options.body.parse(await readJsonBody(req, options.maxBodyBytes ?? DEFAULT_MAX_BODY))
        : undefined;

      // 4. Idempotency (state-changing POSTs).
      if (options.idempotent) {
        const key = req.headers.get("idempotency-key") ?? "";
        if (!IDEMPOTENCY_KEY.test(key)) {
          throw new AppError("VALIDATION_FAILED", {
            message:
              "An Idempotency-Key header (8-128 characters: letters, digits, - or _) is required.",
          });
        }
        const scope = `${options.name}|${user?.uid ?? `ip:${ipTag}`}|${key}`;
        const requestHash = shortHash(toJson({ query, body, params }));
        const begun = await services.idempotency.begin(scope, requestHash);
        markPhase("idem");
        if (begun.state === "replay") {
          logRequest("info", { status: begun.response.status, replayed: true });
          return jsonResponse(begun.response.body, begun.response.status, requestId, {
            "Idempotent-Replayed": "true",
            ...timingHeaders(),
          });
        }
        idempotencyScope = scope;
      }

      // 5. Handler.
      const output = await handler({
        req,
        requestId,
        user,
        body: body as Parsed<B>,
        query: query as Parsed<Q>,
        params,
        ipTag,
      });
      markPhase("app");
      // A raw Response (file download) passes through with the standard headers added.
      if (output instanceof Response) {
        output.headers.set("X-Request-Id", requestId);
        if (!output.headers.has("Cache-Control")) output.headers.set("Cache-Control", "no-store");
        for (const [name, value] of Object.entries(timingHeaders()))
          output.headers.set(name, value);
        logRequest("info", { status: output.status });
        return output as unknown as NextResponse;
      }
      const result = isRouteResult(output) ? output : respond(output);
      const payload = toJson({ ok: true, data: result.data });
      if (idempotencyScope) {
        const scope = idempotencyScope;
        // The handler's effects already happened: never turn this into an error (which would release
        // the key and let a retry run them twice). A failed store leaves the claim "pending", so a
        // retry within its TTL gets CONFLICT instead of a second execution.
        idempotencyScope = undefined;
        try {
          await services.idempotency.complete(scope, { status: result.status, body: payload });
        } catch (error) {
          log("error", "idempotency.complete_failed", {
            route: options.name,
            requestId,
            ...errorFields(error),
          });
        }
      }
      logRequest("info", { status: result.status });
      return jsonResponse(payload, result.status, requestId, {
        ...(options.cacheControl ? { "Cache-Control": options.cacheControl } : {}),
        ...result.headers,
        ...timingHeaders(),
      });
    } catch (thrown) {
      const error = toAppError(thrown);
      if (idempotencyScope)
        await services.idempotency.abandon(idempotencyScope).catch(() => undefined);
      logRequest(error.status >= 500 ? "error" : "info", {
        status: error.status,
        ...errorFields(error),
      });
      const envelope: ApiEnvelope<never> = {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          requestId,
          ...(error.details ? { details: error.details } : {}),
        },
      };
      return jsonResponse(toJson(envelope), error.status, requestId, {
        ...(error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}),
        ...timingHeaders(),
      });
    }
  }
}
