import "server-only";
import { ZodError } from "zod";

/**
 * The single error catalogue of the API. Every failure leaves the server as
 * `{ ok: false, error: { code, message, requestId } }` with the catalogue's HTTP status; `message`
 * is always user-safe (internal causes are logged, never returned).
 */
export const ERROR_CATALOGUE = {
  AUTH_REQUIRED: { status: 401, message: "Please sign in to continue." },
  FORBIDDEN: { status: 403, message: "You are not allowed to do this." },
  VALIDATION_FAILED: { status: 400, message: "Some fields are missing or invalid." },
  RATE_LIMITED: { status: 429, message: "Too many requests. Please try again shortly." },
  NOT_FOUND: { status: 404, message: "We could not find that." },
  CONFLICT: { status: 409, message: "This conflicts with an existing record." },
  CHAIN_STATE_MISMATCH: {
    status: 409,
    message: "The deal's on-chain state does not allow this right now.",
  },
  TX_FAILED: { status: 502, message: "The blockchain transaction failed. Please try again." },
  VAULT_LOCKED: { status: 423, message: "This is locked until the deal allows it." },
  INTERNAL: { status: 500, message: "Something went wrong on our side." },
} as const;

export type ErrorCode = keyof typeof ERROR_CATALOGUE;

/** JSON-safe extra information for the client (never secrets, never personal data). */
export type ErrorDetails = Record<string, unknown>;

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: ErrorDetails;
  /** Seconds, sent as Retry-After for RATE_LIMITED. */
  readonly retryAfter?: number;

  constructor(
    code: ErrorCode,
    options: {
      message?: string;
      details?: ErrorDetails;
      retryAfter?: number;
      cause?: unknown;
    } = {},
  ) {
    super(options.message ?? ERROR_CATALOGUE[code].message, { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.status = ERROR_CATALOGUE[code].status;
    this.details = options.details;
    this.retryAfter = options.retryAfter;
  }
}

/** Maps anything thrown by a handler to an AppError (unknown errors become INTERNAL). */
/** viem's errors for an RPC node that is unreachable or does not answer in time. */
const UNREACHABLE = new Set(["TimeoutError", "HttpRequestError", "WebSocketRequestError"]);

/** Walks an error's `cause` chain (libraries such as viem wrap the original error). */
function causes(error: unknown): unknown[] {
  const chain: unknown[] = [];
  for (let current = error; current && chain.length < 10; current = (current as Error).cause) {
    chain.push(current);
  }
  return chain;
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  // A user-safe error raised deep inside a library call (e.g. a deadline in the RPC transport).
  const inner = causes(error).find((cause): cause is AppError => cause instanceof AppError);
  if (inner) return inner;
  if (causes(error).some((cause) => cause instanceof Error && UNREACHABLE.has(cause.name))) {
    return new AppError("INTERNAL", {
      message: "RewardRelay is temporarily unavailable. Please try again shortly.",
      cause: error,
    });
  }
  if (error instanceof ZodError) {
    return new AppError("VALIDATION_FAILED", {
      details: {
        issues: error.issues.map((issue) => ({
          path: issue.path.map(String).join("."),
          message: issue.message,
        })),
      },
      cause: error,
    });
  }
  return new AppError("INTERNAL", { cause: error });
}
