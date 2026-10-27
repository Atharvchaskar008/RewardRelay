import { withRoute, respond } from "@/src/server/http";
import { healthReport } from "@/src/server/health";

export const dynamic = "force-dynamic";

/**
 * GET /api/health → RPC + latest block, signer balances (low-balance warning), Firestore, contract
 * addresses. 200 when ok or degraded, 503 when the chain is unreachable. No secrets.
 */
export const GET = withRoute(
  { name: "health", auth: "none", rateLimit: { capacity: 30, refillPerMinute: 30 } },
  async () => {
    const report = await healthReport();
    return respond(report, { status: report.status === "down" ? 503 : 200 });
  },
);
