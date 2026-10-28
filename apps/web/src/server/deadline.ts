import "server-only";
import { AppError } from "./errors";

/**
 * Deadline for backend calls in the request path (Firestore, Firebase Auth). When a backend is
 * unreachable its SDK keeps retrying for a long time; a request must fail fast with a user-safe
 * INTERNAL error instead of hanging until the platform timeout. Generous enough for Firestore
 * transaction contention (a few seconds on the emulator).
 *
 * Note: this stops *waiting*; it cannot cancel the underlying call, which may still complete.
 */
export const BACKEND_DEADLINE_MS = 8_000;

/** Raised when a backend call misses its deadline; `operation` names the call in the logs. */
export class DeadlineExceeded extends Error {
  constructor(
    readonly operation: string,
    readonly ms: number,
  ) {
    super(`${operation} timed out after ${ms} ms`);
    this.name = "DeadlineExceeded";
  }
}

export function withDeadline<T>(
  work: Promise<T>,
  ms: number = BACKEND_DEADLINE_MS,
  operation = "backend call",
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new AppError("INTERNAL", {
            message: "SAKAR is temporarily unavailable. Please try again shortly.",
            cause: new DeadlineExceeded(operation, ms),
          }),
        ),
      ms,
    );
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}
