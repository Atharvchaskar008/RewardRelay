import { z } from "zod";
import { withRoute } from "@/server/http";
import { resolveDispute } from "@/server/disputes/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/admin/disputes/:id/resolve {seekerShareBps, faultParty, reason} (ADMIN_UIDS; Idempotency-Key)
 * Re-reads Disputed, calls resolveDispute through the ARBITER signer, writes an append-only audit record.
 */
export const POST = withRoute(
  {
    name: "admin.disputes.resolve",
    admin: true,
    idempotent: true,
    body: z
      .object({
        seekerShareBps: z.number().int().min(0).max(10_000),
        faultParty: z.enum(["None", "Sharer", "Seeker"]),
        reason: z.string().trim().min(5).max(500),
      })
      .strict(),
    rateLimit: { capacity: 10, refillPerMinute: 10 },
  },
  async ({ body, user, params }) => resolveDispute(user!.uid, params.id, body),
);
