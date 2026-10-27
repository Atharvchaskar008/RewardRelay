import { getAddress, isAddress } from "viem";
import { explorerAddressUrl, readTrust, sbtContract } from "@/server/chain";
import { AppError } from "@/server/errors";
import { withRoute } from "@/server/http";
import { TIER_NAMES, money } from "@/server/views/user";

export const dynamic = "force-dynamic";

/** GET /api/badges/:address → the public Trust Badge of any address (read from chain). */
export const GET = withRoute(
  { name: "badges.get", auth: "none", rateLimit: { capacity: 60, refillPerMinute: 60 } },
  async ({ params }) => {
    if (!params.address || !isAddress(params.address)) {
      throw new AppError("VALIDATION_FAILED", { message: "Invalid address." });
    }
    const address = getAddress(params.address);
    const [trust, stats] = await Promise.all([
      readTrust(address),
      sbtContract().read.statsOf([address]),
    ]);
    return {
      address,
      hasBadge: trust.hasBadge,
      tokenId: BigInt(address).toString(),
      locked: trust.hasBadge,
      tier: trust.tier,
      tierName: TIER_NAMES[trust.tier] ?? `Tier ${trust.tier}`,
      completed: trust.completed,
      disputesLost: trust.disputesLost,
      uniqueCounterparties: Number(stats.uniqueCounterparties),
      relayPoints: trust.relayPoints.toString(),
      volume: money(stats.volume),
      maxDealValue: money(trust.maxDealValue),
      mstscanUrl: explorerAddressUrl(address),
      badgeContractUrl: explorerAddressUrl(sbtContract().address),
    };
  },
);
