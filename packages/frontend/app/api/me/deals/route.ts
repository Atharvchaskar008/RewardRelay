import { withRoute } from "@/src/server/http";
import { myDeals } from "@/src/server/deals/mine";

export const dynamic = "force-dynamic";

/** GET /api/me/deals → the caller's deals as sharer or seeker (newest first). */
export const GET = withRoute(
  { name: "me.deals", rateLimit: { capacity: 60, refillPerMinute: 60 } },
  async ({ user }) => myDeals(user!.uid),
);
