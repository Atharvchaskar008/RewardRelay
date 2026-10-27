import { z } from "zod";
import { withRoute } from "@/src/server/http";
import { authorizeCode } from "@/src/server/vault/authorize";

export const dynamic = "force-dynamic";

/**
 * POST /api/codes/authorize {code, category} (Pass-on, before createListing; Idempotency-Key)
 * → {fingerprint, auth: {nonce, deadline, signature}} for RelayEscrow.createListing.
 * The code is sealed (encrypted) in the vault; duplicates are refused.
 */
export const POST = withRoute(
  {
    name: "codes.authorize",
    idempotent: true,
    body: z
      .object({ code: z.string().min(1).max(128), category: z.string().min(1).max(32) })
      .strict(),
    rateLimit: { capacity: 10, refillPerMinute: 10 },
  },
  async ({ body, user }) => authorizeCode(user!.uid, body),
);
