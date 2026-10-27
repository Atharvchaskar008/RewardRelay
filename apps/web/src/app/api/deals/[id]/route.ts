import { releaseOnVisit } from "@/server/cron/release";
import { withRoute } from "@/server/http";
import { syncDealIndex } from "@/server/deals/dealIndex";
import { walletOf } from "@/server/identity/users";
import { dealIdParam } from "@/server/validation/common";
import { readDealOrThrow } from "@/server/deals/read";
import { buildDealView } from "@/server/views/deal";

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
    // Release-on-visit: a due deal is released in the background; the cron remains the guarantee.
    if (view.nextAction === "RELEASE_AVAILABLE") releaseOnVisit(view.id);
    return view;
  },
);
