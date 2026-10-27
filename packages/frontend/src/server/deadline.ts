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

export function withDeadline<T>(work: Promise<T>, ms: number = BACKEND_DEADLINE_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new AppError("INTERNAL", {
            message: "RewardRelay is temporarily unavailable. Please try again shortly.",
          }),
        ),
      ms,
    );
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}
