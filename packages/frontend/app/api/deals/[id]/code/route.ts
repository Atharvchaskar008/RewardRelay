import { withRoute } from "@/src/server/http";
import { revealCode } from "@/src/server/vault/reveal";

export const dynamic = "force-dynamic";

/** GET /api/deals/:id/code (Pass-on seeker, once paid) → the code; Cache-Control: no-store. */
export const GET = withRoute(
  { name: "deals.code.get", rateLimit: { capacity: 20, refillPerMinute: 10 } },
  async ({ user, params }) => revealCode(user!, params.id),
);
