import { z } from "zod";
import { withRoute } from "@/server/http";
import { createChallenge } from "@/server/identity/siwe";
import { addressInput } from "@/server/validation/common";

export const dynamic = "force-dynamic";

/** POST /api/auth/challenge {address} → a single-use EIP-4361 message to sign (valid 5 minutes). */
export const POST = withRoute(
  {
    name: "auth.challenge",
    body: z.object({ address: addressInput }),
    rateLimit: { capacity: 10, refillPerMinute: 10 },
  },
  async ({ body, user }) => createChallenge(user!.uid, body.address),
);
