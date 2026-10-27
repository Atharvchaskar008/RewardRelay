import { z } from "zod";
import { withRoute } from "@/server/http";
import { linkWallet } from "@/server/identity/onboarding";
import { addressInput, signatureInput } from "@/server/validation/common";

export const dynamic = "force-dynamic";
/** Minting and the top-up wait for receipts. */
export const maxDuration = 60;

/**
 * POST /api/auth/link-wallet {address, message, signature} (Idempotency-Key required)
 * Verified phone + signed challenge → user record, Trust Badge, one welcome top-up → user view.
 */
export const POST = withRoute(
  {
    name: "auth.link-wallet",
    idempotent: true,
    body: z.object({
      address: addressInput,
      message: z.string().min(1).max(2_000),
      signature: signatureInput,
    }),
    rateLimit: { capacity: 5, refillPerMinute: 5 },
  },
  async ({ body, user }) => linkWallet(user!, body),
);
