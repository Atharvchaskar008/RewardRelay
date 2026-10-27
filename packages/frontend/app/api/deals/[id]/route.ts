import { withRoute } from "@/src/server/http";
import { syncDealIndex } from "@/src/server/deals/dealIndex";
import { walletOf } from "@/src/server/identity/users";
import { dealIdParam } from "@/src/server/validation/common";
import { readDealOrThrow } from "@/src/server/deals/read";
import { buildDealView } from "@/src/server/views/deal";

export const dynamic = "force-dynamic";

/** GET /api/deals/:id → the deal room view model for the caller (signed in or not). */
export const GET = withRoute(
  { name: "deals.get", auth: "optional", rateLimit: { capacity: 120, refillPerMinute: 120 } },
  async ({ params, user }) => {
    const id = dealIdParam(params.id);
    const wallet = user ? await walletOf(user.uid) : null;
    const deal = await readDealOrThrow(id);
    const view = await buildDealView(id, user ? { uid: user.uid, wallet } : null, deal);
    await syncDealIndex(
      view.id,
      deal,
      view.role === "seeker" && user ? { seekerUid: user.uid } : {},
    );
    return view;
  },
);
