import "server-only";
import {
  createPublicClient,
  defineChain,
  getContract,
  http,
  type Address,
  type Chain,
  type Hash,
  type PublicClient,
  type Transport,
} from "viem";
import { chainById, relayEscrowAbi, reputationSbtAbi } from "rewardrelay-shared";
import { serverEnv, type ServerEnv } from "./env";

/**
 * Read access to MST through viem. The chain definition comes from packages/shared and is pointed
 * at the configured RPC URL, so the same code serves MST Testnet and a local Hardhat node.
 */

const RPC_TIMEOUT_MS = 10_000;
const RPC_RETRIES = 3;
const RPC_RETRY_DELAY_MS = 300;

export function mstChain(env: ServerEnv = serverEnv()): Chain {
  const known = chainById(env.MST_CHAIN_ID);
  return defineChain({
    id: env.MST_CHAIN_ID,
    name: known?.name ?? `Chain ${env.MST_CHAIN_ID}`,
    nativeCurrency: known?.nativeCurrency ?? { name: "MST Coin", symbol: "MSTC", decimals: 18 },
    rpcUrls: { default: { http: [env.MST_RPC_URL] } },
    blockExplorers: { default: { name: "MSTScan", url: env.MST_EXPLORER_URL } },
    testnet: known?.testnet ?? true,
  });
}

/** HTTP transport with timeout and exponential retry (viem retries network errors and 5xx/429). */
export function rpcTransport(env: ServerEnv = serverEnv()): Transport {
  return http(env.MST_RPC_URL, {
    timeout: RPC_TIMEOUT_MS,
    retryCount: RPC_RETRIES,
    retryDelay: RPC_RETRY_DELAY_MS,
  });
}

let client: PublicClient | undefined;

export function publicClient(): PublicClient {
  client ??= createPublicClient({ chain: mstChain(), transport: rpcTransport() }) as PublicClient;
  return client;
}

export function escrowContract() {
  return getContract({
    address: serverEnv().ESCROW_ADDRESS,
    abi: relayEscrowAbi,
    client: publicClient(),
  });
}

export function sbtContract() {
  return getContract({
    address: serverEnv().SBT_ADDRESS,
    abi: reputationSbtAbi,
    client: publicClient(),
  });
}

export type OnChainDeal = Awaited<ReturnType<ReturnType<typeof escrowContract>["read"]["getDeal"]>>;

export interface TrustSummary {
  hasBadge: boolean;
  tier: number;
  completed: number;
  disputesLost: number;
  relayPoints: bigint;
  maxDealValue: bigint;
}

/** The deal as stored on-chain. Unknown ids revert with `DealNotFound`. */
export function readDeal(id: bigint): Promise<OnChainDeal> {
  return escrowContract().read.getDeal([id]);
}

export async function readTrust(account: Address): Promise<TrustSummary> {
  const [hasBadge, tier, completed, disputesLost, relayPoints, maxDealValue] =
    await sbtContract().read.trustOf([account]);
  return { hasBadge, tier, completed, disputesLost, relayPoints, maxDealValue };
}

export async function readNextAction(id: bigint, account: Address): Promise<number> {
  return escrowContract().read.nextActionFor([id, account]);
}

export function explorerTxUrl(hash: Hash): string {
  return `${serverEnv().MST_EXPLORER_URL.replace(/\/$/, "")}/tx/${hash}`;
}

export function explorerAddressUrl(account: Address): string {
  return `${serverEnv().MST_EXPLORER_URL.replace(/\/$/, "")}/address/${account}`;
}

/** Test hook: drop the cached client (after the environment changes). */
export function resetChainClientForTests(): void {
  client = undefined;
}
