import { serverEnv } from "@/src/server/env";
import { withRoute } from "@/src/server/http";

export const dynamic = "force-dynamic";

/** Liveness probe: proves the env is valid and the route wrapper answers with the envelope. */
export const GET = withRoute({ name: "health", auth: "none", rateLimit: false }, async () => {
  const env = serverEnv();
  return {
    status: "ok",
    service: "rewardrelay-api",
    chainId: env.MST_CHAIN_ID,
    contracts: { escrow: env.ESCROW_ADDRESS, badge: env.SBT_ADDRESS },
    time: new Date().toISOString(),
  };
});
