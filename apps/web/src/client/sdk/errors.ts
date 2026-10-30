/**
 * Errors the SDK throws. `ApiError` mirrors the server's error catalogue; `ChainError` wraps a failed
 * or rejected transaction with a user-safe message derived from the contract's custom error name.
 * `userMessage(error)` gives one sentence for any error the UI catches.
 */

export type ApiErrorCode =
  | "AUTH_REQUIRED"
  | "FORBIDDEN"
  | "VALIDATION_FAILED"
  | "RATE_LIMITED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "CHAIN_STATE_MISMATCH"
  | "TX_FAILED"
  | "VAULT_LOCKED"
  | "INTERNAL"
  | "NETWORK";

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly status: number,
    readonly requestId?: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** RelayEscrow / ReputationSBT custom errors → what the user should read. */
export const REVERT_MESSAGES: Record<string, string> = {
  NoTrustBadge: "You need a Trust Badge first. Finish signing up to get one.",
  DealValueAboveLimit: "This deal is above your Trust Badge limit.",
  SharerCannotAccept: "You cannot accept your own listing.",
  InvalidStatus: "This deal has moved on. Refresh to see what happened.",
  DealNotFound: "This deal does not exist.",
  IncorrectPayment: "The payment amount does not match the deal. Refresh and try again.",
  PolicyInactive: "This category is not open right now.",
  InvalidPrice: "The price is not valid.",
  TermsRequired: "The listing terms are missing.",
  InvalidEventTime: "The event time must be in the future (within a year).",
  EventPassed: "The event has already started.",
  FingerprintRequired: "Pass-on listings need a code.",
  FingerprintNotAllowed: "This category does not take a code.",
  FingerprintAlreadyUsed: "This code has already been listed.",
  AuthorizationExpired: "The code authorisation expired. Please try again.",
  InvalidAuthorization: "The code authorisation is not valid. Please try again.",
  DeliveryWindowClosed: "The delivery window has closed.",
  DeliveryWindowOpen: "The sharer can still deliver. A refund is possible only after the deadline.",
  ProofRequired: "An order proof is required.",
  ReleaseNotDue: "The check window is still open; release is not due yet.",
  DisputeWindowClosed: "The check window has closed, so a dispute can no longer be raised.",
  EvidenceRequired: "Evidence is required.",
  EvidenceWindowClosed: "The evidence window has closed.",
  ArbiterTimeoutNotReached: "The arbiter still has time to rule.",
  NotSharer: "Only the sharer can do this.",
  NotSeeker: "Only the seeker can do this.",
  NotParty: "Only the deal's parties can do this.",
  NothingToWithdraw: "There is nothing to withdraw.",
  TransferFailed: "The transfer failed. Please try again.",
  EnforcedPause: "New deals are paused for maintenance. Open deals keep working.",
  AlreadyHasBadge: "This wallet already has a Trust Badge.",
};

export class ChainError extends Error {
  constructor(
    message: string,
    readonly reason?: string,
    readonly hash?: string,
    readonly original?: unknown,
  ) {
    super(message);
    this.name = "ChainError";
  }
}

/** Custom-error name of a viem contract error, if any. */
export function revertReason(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; current && depth < 8; depth++) {
    const data = (current as { data?: { errorName?: unknown } }).data;
    if (data && typeof data.errorName === "string") return data.errorName;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Converts any viem/wallet error into a ChainError with a user-safe message. */
export function toChainError(error: unknown, hash?: string): ChainError {
  if (error instanceof ChainError) return error;
  const reason = revertReason(error);
  if (reason)
    return new ChainError(
      REVERT_MESSAGES[reason] ?? "The transaction was rejected.",
      reason,
      hash,
      error,
    );
  const text =
    error instanceof Error ? `${error.name} ${error.message}`.toLowerCase() : String(error);
  if (text.includes("insufficient funds")) {
    return new ChainError(
      "Not enough MSTC for this payment and its gas.",
      "InsufficientFunds",
      hash,
      error,
    );
  }
  if (
    text.includes("user rejected") ||
    text.includes("denied") ||
    text.includes("rejected the request") ||
    (error as { code?: unknown })?.code === 4001
  ) {
    return new ChainError(
      "You cancelled or rejected the prompt in your wallet.",
      "UserRejected",
      hash,
      error,
    );
  }
  if (text.includes("already pending") || (error as { code?: unknown })?.code === -32002) {
    return new ChainError(
      "A wallet prompt is already open. Please open your BridgeKey or MetaMask extension popup to approve it.",
      "PendingRequest",
      hash,
      error,
    );
  }
  if (text.includes("timed out") || text.includes("timeout")) {
    return new ChainError(
      "The network is slow. Check the transaction on mstscan before retrying.",
      "Timeout",
      hash,
      error,
    );
  }
  return new ChainError("The transaction failed. Please try again.", undefined, hash, error);
}

/** Firebase Auth (phone sign-in) error codes the user can act on. */
const AUTH_MESSAGES: Record<string, string> = {
  "auth/invalid-phone-number":
    "Enter the mobile number with its country code, e.g. +91 98765 43210.",
  "auth/missing-phone-number": "Enter your mobile number.",
  "auth/invalid-verification-code": "That code is not right. Check it and try again.",
  "auth/missing-verification-code": "Enter the 6-digit code.",
  "auth/code-expired": "That code has expired. Request a new one.",
  "auth/too-many-requests": "Too many attempts. Wait a few minutes and try again.",
  "auth/quota-exceeded": "We cannot send more codes right now. Try again later.",
  "auth/operation-not-allowed": "Sign-in by SMS is not enabled for this number's region yet.",
  "auth/captcha-check-failed": "The security check failed. Refresh the page and try again.",
  "auth/network-request-failed": "No internet connection. Check it and try again.",
};

/** One sentence for the UI. */
export function userMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof ChainError) return error.message;
  if (error instanceof Error && error.name === "WalletLockedError") return error.message;
  if (error instanceof Error && error.name === "WrongPinError") return error.message;
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && AUTH_MESSAGES[code]) return AUTH_MESSAGES[code];
  return "Something went wrong. Please try again.";
}
