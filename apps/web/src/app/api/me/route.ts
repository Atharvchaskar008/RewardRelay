import { getAddress } from "viem";
import { AppError } from "@/server/errors";
import { withRoute } from "@/server/http";
import { repos } from "@/server/repositories";
import { buildUserView } from "@/server/views/user";

export const dynamic = "force-dynamic";

/** GET /api/me → the user view re-read from the chain; NOT_FOUND until a wallet is linked. */
export const GET = withRoute(
  { name: "me", rateLimit: { capacity: 60, refillPerMinute: 60 } },
  async ({ user }) => {
    const record = await repos.users.get(user!.uid);
    if (!record)
      throw new AppError("NOT_FOUND", { message: "No wallet is linked to this account yet." });
    return buildUserView(getAddress(record.wallet), record);
  },
);
