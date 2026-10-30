import { z } from "zod";
import { withRoute } from "@/server/http";
import { adminAuth } from "@/server/firebaseAdmin";
import { addressInput } from "@/server/validation/common";

export const dynamic = "force-dynamic";

/** POST /api/auth/token {address} → custom Firebase token for wallet-based authentication. */
export const POST = withRoute(
  {
    name: "auth.token",
    auth: "none",
    body: z.object({ address: addressInput }),
    rateLimit: { capacity: 20, refillPerMinute: 20 },
  },
  async ({ body }) => {
    const uid = `wallet:${body.address.toLowerCase()}`;
    const token = await adminAuth().createCustomToken(uid);
    return { token, uid };
  },
);
