import { safeEqual } from "@/src/server/crypto";
import { serverEnv } from "@/src/server/env";
import { AppError } from "@/src/server/errors";
import { withRoute } from "@/src/server/http";
import { runReleaseCron } from "@/src/server/cron/release";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/release — keeper run (cron-job.org every 2 minutes, see API.md).
 * Requires `X-Cron-Secret: <CRON_SECRET>` (or `Authorization: Bearer <CRON_SECRET>`), compared in
 * constant time. Safe to call concurrently: a Firestore lease admits one run at a time.
 */
export const GET = withRoute(
  { name: "cron.release", auth: "none", rateLimit: false },
  async ({ req }) => {
    const header = req.headers.get("x-cron-secret") ?? "";
    const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const presented = header || bearer;
    if (!presented || !safeEqual(presented, serverEnv().CRON_SECRET))
      throw new AppError("FORBIDDEN");
    return runReleaseCron();
  },
);
