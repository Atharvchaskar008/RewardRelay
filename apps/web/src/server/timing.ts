import "server-only";
import { AsyncLocalStorage } from "async_hooks";

/**
 * Per-request timing. `withRoute` opens a scope for every request; the Firestore repositories and the
 * RPC transport report each call with `track`, so the response's `Server-Timing` header and the
 * request log show where the time went (route phases plus total busy time per backend).
 * Overlapping calls are summed, so a backend's busy time can exceed the wall-clock time.
 */

/** Firestore, the MST RPC and Firebase Auth's API. */
export type Backend = "db" | "chain" | "identity";

interface Scope {
  phases: [string, number][];
  backends: Record<Backend, { ms: number; calls: number }>;
  last: number;
}

const storage = new AsyncLocalStorage<Scope>();

export function runWithTiming<T>(work: () => Promise<T>): Promise<T> {
  const scope: Scope = {
    phases: [],
    backends: {
      db: { ms: 0, calls: 0 },
      chain: { ms: 0, calls: 0 },
      identity: { ms: 0, calls: 0 },
    },
    last: Date.now(),
  };
  return storage.run(scope, work);
}

/** Ends the current phase (time since the previous mark) under `name`. */
export function markPhase(name: string): void {
  const scope = storage.getStore();
  if (!scope) return;
  const now = Date.now();
  scope.phases.push([name, now - scope.last]);
  scope.last = now;
}

/** Times one backend call within the current request (a no-op outside a request). */
export function track<T>(backend: Backend, work: Promise<T>): Promise<T> {
  const scope = storage.getStore();
  if (!scope) return work;
  const started = Date.now();
  const record = () => {
    scope.backends[backend].ms += Date.now() - started;
    scope.backends[backend].calls += 1;
  };
  return work.then(
    (value) => {
      record();
      return value;
    },
    (error: unknown) => {
      record();
      throw error;
    },
  );
}

/** Phase and backend durations of the current request, for the log. */
export function timingSummary(): Record<string, number> | undefined {
  const scope = storage.getStore();
  if (!scope) return undefined;
  const summary: Record<string, number> = Object.fromEntries(scope.phases);
  for (const [backend, { ms, calls }] of Object.entries(scope.backends)) {
    if (calls > 0) {
      summary[`${backend}Ms`] = ms;
      summary[`${backend}Calls`] = calls;
    }
  }
  return summary;
}

/** `Server-Timing` header value (https://www.w3.org/TR/server-timing/). */
export function serverTimingHeader(totalMs: number): string | undefined {
  const scope = storage.getStore();
  if (!scope) return undefined;
  const entries = scope.phases.map(([name, ms]) => `${name};dur=${ms}`);
  for (const [backend, { ms, calls }] of Object.entries(scope.backends)) {
    if (calls > 0) entries.push(`${backend};dur=${ms};desc="${calls} calls"`);
  }
  entries.push(`total;dur=${totalMs}`);
  return entries.join(", ");
}
