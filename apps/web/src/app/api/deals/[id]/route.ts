import { afterResponse } from "@/server/background";
import { releaseOnVisit } from "@/server/cron/release";
import { withRoute } from "@/server/http";
import { syncDealIndex } from "@/server/deals/dealIndex";
import { walletOf } from "@/server/identity/users";
import { dealIdParam } from "@/server/validation/common";
import { readDealOrThrow } from "@/server/deals/read";
import { buildDealView } from "@/server/views/deal";

export const dynamic = "force-dynamic";
/** A due deal is released after the response; the function stays alive until it is mined. */
export const maxDuration = 60;

/** GET /api/deals/:id → the deal room view model for the caller (signed in or not). */
export const GET = withRoute(
  { name: "deals.get", auth: "optional", rateLimit: { capacity: 120, refillPerMinute: 120 } },
  async ({ params, user }) => {
    const id = dealIdParam(params.id);
    // The deal and the caller's wallet are read alongside everything else the view needs.
    const dealCall = readDealOrThrow(id, { shared: true });
    const viewer = user ? walletOf(user.uid).then((wallet) => ({ uid: user.uid, wallet })) : null;
    const view = await buildDealView(id, viewer, dealCall);
    const deal = await dealCall;
    // Keeping the Firestore index in step with the chain does not need to delay the response.
    await afterResponse("deals.sync_index", () =>
      syncDealIndex(view.id, deal, view.role === "seeker" && user ? { seekerUid: user.uid } : {}),
    );
    // Release-on-visit: a due deal is released after the response; the cron remains the guarantee.
    if (view.nextAction === "RELEASE_AVAILABLE") await releaseOnVisit(view.id);
    return view;
  },
);
