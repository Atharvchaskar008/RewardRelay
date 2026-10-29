import "server-only";
import { isAddress, isHex, type Address, type Hex } from "viem";
import { z } from "zod";
import { withRoute } from "@/server/http";
import { txManager } from "@/server/signer";
import { serverEnv } from "@/server/env";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/relay
 * Gas Relayer service for SAKAR dApp on MST Blockchain.
 * Allows users to execute transactions without holding native MSTC tokens for gas fees.
 * SAKAR sponsors the gas via server TxManager.
 */
export const POST = withRoute(
  {
    name: "relay.send",
    auth: "optional",
    body: z.object({
      to: z.string().refine(isAddress, "invalid destination address"),
      data: z.string().refine(isHex, "invalid transaction calldata").optional(),
      value: z.string().regex(/^\d+$/, "value must be in wei").optional(),
    }),
    rateLimit: { capacity: 10, refillPerMinute: 10 },
  },
  async ({ body }) => {
    const env = serverEnv();
    const funder = txManager("funder");

    const result = await funder.send({
      to: body.to as Address,
      data: body.data as Hex | undefined,
      value: body.value ? BigInt(body.value) : 0n,
    });

    return {
      success: true,
      hash: result.hash,
      status: result.status,
      blockNumber: result.blockNumber.toString(),
      gasUsed: result.gasUsed.toString(),
      explorerUrl: `${env.MST_EXPLORER_URL}/tx/${result.hash}`,
      sponsoredBy: funder.address,
    };
  },
);

