import { withRoute } from "@/server/http";
import { listOpenDisputes } from "@/server/disputes/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET /api/admin/disputes (ADMIN_UIDS) → open on-chain disputes with evidence and a suggested ruling. */
export const GET = withRoute(
  { name: "admin.disputes.list", admin: true, rateLimit: { capacity: 30, refillPerMinute: 30 } },
  async ({ user }) => listOpenDisputes(user!.uid),
);
