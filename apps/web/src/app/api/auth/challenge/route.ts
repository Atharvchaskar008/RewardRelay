import { z } from "zod";
import { withRoute } from "@/server/http";
import { createChallenge } from "@/server/identity/siwe";
import { addressInput } from "@/server/validation/common";

export const dynamic = "force-dynamic";

/** POST /api/auth/challenge {address} → a single-use EIP-4361 message to sign (valid 5 minutes). */
export const POST = withRoute(
  {
    name: "auth.challenge",
    auth: "none",
    body: z.object({
      address: addressInput,
      origin: z.string().url().optional(),
    }),
    rateLimit: { capacity: 30, refillPerMinute: 30 },
  },
  async ({ body, user, req }) => {
    const uid = user?.uid ?? `wallet:${body.address.toLowerCase()}`;
    const headerOrigin = req.headers.get("origin");
    const forwardedHost = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    const forwardedProto = req.headers.get("x-forwarded-proto") ?? "https";
    const fallbackOrigin = forwardedHost ? `${forwardedProto}://${forwardedHost}` : undefined;
    const origin = body.origin ?? headerOrigin ?? fallbackOrigin;
    return createChallenge(uid, body.address, Date.now(), origin);
  },
);
