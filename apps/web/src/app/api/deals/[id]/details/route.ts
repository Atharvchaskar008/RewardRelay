import { withRoute } from "@/server/http";
import { deliveryDetailsSchema, readDetails, submitDetails } from "@/server/deals/details";

export const dynamic = "force-dynamic";

/** POST /api/deals/:id/details (seeker, while Locked; Idempotency-Key) → stores them encrypted. */
export const POST = withRoute(
  {
    name: "deals.details.post",
    idempotent: true,
    body: deliveryDetailsSchema,
    rateLimit: { capacity: 10, refillPerMinute: 5 },
  },
  async ({ body, user, params }) => submitDetails(user!, params.id, body),
);

/** GET /api/deals/:id/details (sharer, while Locked or Delivered) → decrypted; access is logged. */
export const GET = withRoute(
  { name: "deals.details.get", strict: true, rateLimit: { capacity: 30, refillPerMinute: 30 } },
  async ({ user, params }) => readDetails(user!, params.id),
);
