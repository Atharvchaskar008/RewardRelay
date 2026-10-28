import type { Address } from "viem";
import { chainById, deployments, MST_TESTNET, rpcRelayPath } from "@rewardrelay/shared";
import type { RewardRelayConfig } from "@/client/sdk";

/**
 * Public (browser) configuration from NEXT_PUBLIC_* variables. The chain id selects the defaults
 * (relay path, explorer, recorded escrow) from packages/shared, so moving from MST Testnet to MST
 * Mainnet is a matter of env. Nothing here is secret.
 */

const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || MST_TESTNET.id);
const chain = chainById(chainId);
const recordedEscrow = Object.values(
  deployments as Record<
    string,
    { chainId: number; contracts: Record<string, { address: string }> }
  >,
).find((deployment) => deployment.chainId === chainId)?.contracts.RelayEscrow?.address;

/** True on MST Mainnet (real MSTC); false on MST Testnet and the local chain. */
export const isMainnet = chain?.testnet === false;
/** The network for user-facing copy, e.g. "MST Testnet". */
export const networkName = chain?.name ?? `Chain ${chainId}`;
/** How the coin is called in copy: "test MSTC" away from mainnet. */
export const coinLabel = isMainnet ? "MSTC" : "test MSTC";

export const appConfig: RewardRelayConfig = {
  apiBaseUrl: "",
  chain: {
    chainId,
    // Same-origin relay for the configured chain (MST RPC nodes send no CORS headers).
    rpcUrl: process.env.NEXT_PUBLIC_RPC_URL || rpcRelayPath(chainId) || "/api/rpc/testnet",
    explorerUrl:
      process.env.NEXT_PUBLIC_MSTSCAN_URL ||
      chain?.blockExplorers?.default.url ||
      MST_TESTNET.blockExplorers.default.url,
    escrow: (process.env.NEXT_PUBLIC_ESCROW_ADDRESS ||
      recordedEscrow ||
      "0x0000000000000000000000000000000000000000") as Address,
  },
  inrPerMstc: Number(process.env.NEXT_PUBLIC_DEMO_RATE_INR_PER_MSTC || 100_000),
};

export const firebaseWebConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "",
};

export const authEmulatorHost = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST || "";

/** Phone sign-in works when a Firebase web app is configured (or the Auth emulator is set). */
export const firebaseConfigured = Boolean(
  (firebaseWebConfig.apiKey && firebaseWebConfig.projectId) || authEmulatorHost,
);
