import "server-only";
import { after } from "next/server";
import { errorFields, log } from "./log";

/**
 * Runs `task` after the response has been sent, so it does not add to the request's latency. On
 * Vercel `after` keeps the function alive until the task finishes (a bare unawaited promise can be
 * cut off when the response ends). Outside a Next request (scripts, tests) the task runs inline.
 * Failures are logged, never thrown: callers use this only for best-effort work.
 */
export async function afterResponse(name: string, task: () => Promise<unknown>): Promise<void> {
  const run = async () => {
    try {
      await task();
    } catch (error) {
      log("warn", "background.failed", { task: name, ...errorFields(error) });
    }
  };
  try {
    after(run);
  } catch {
    await run();
  }
}
