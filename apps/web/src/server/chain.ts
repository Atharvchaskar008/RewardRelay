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
import { getAbiItem, pad, parseEventLogs, toEventSelector, toHex, type AbiEvent } from "viem";
import { chainById, deployments, relayEscrowAbi, reputationSbtAbi } from "@rewardrelay/shared";
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
    // MST has no Multicall3; concurrent reads are grouped into JSON-RPC batches instead.
    batch: { batchSize: 25, wait: 10 },
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

/** Runs `work` over `items` with at most `limit` in flight (keeps RPC batches small). */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function lane() {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}

/** Deals by id (unknown ids → null), read with bounded concurrency. */
export function readDeals(ids: readonly bigint[]): Promise<(OnChainDeal | null)[]> {
  return mapLimit(ids, 8, (id) => readDeal(id).catch(() => null));
}

/** Block the escrow was deployed in (from packages/shared), so event scans start there. */
export function escrowDeployBlock(): bigint {
  const escrow = serverEnv().ESCROW_ADDRESS.toLowerCase();
  for (const network of Object.values(deployments) as {
    contracts: Record<string, { address: string; blockNumber: number }>;
  }[]) {
    const record = network.contracts.RelayEscrow;
    if (record && record.address.toLowerCase() === escrow) return BigInt(record.blockNumber);
  }
  return 0n;
}

export interface DealEvent {
  name: string;
  args: Record<string, unknown>;
  blockNumber: bigint;
  transactionHash: Hash;
  timestamp: number;
}

/** Escrow events whose first indexed field is the deal id (PolicySet indexes a category instead). */
const DEAL_EVENTS = [
  "ListingCreated",
  "ListingCancelled",
  "DealLocked",
  "Delivered",
  "Completed",
  "Refunded",
  "DisputeRaised",
  "EvidenceAdded",
  "DisputeResolved",
  "PayoutDeferred",
] as const;

const DEAL_EVENT_TOPICS = DEAL_EVENTS.map((name) =>
  toEventSelector(getAbiItem({ abi: relayEscrowAbi, name }) as AbiEvent),
);

/** Every escrow event of one deal, with block timestamps. */
export async function readDealEvents(id: bigint): Promise<DealEvent[]> {
  const client = publicClient();
  const logs = await client.request({
    method: "eth_getLogs",
    params: [
      {
        address: serverEnv().ESCROW_ADDRESS,
        topics: [DEAL_EVENT_TOPICS, pad(toHex(id), { size: 32 })],
        fromBlock: toHex(escrowDeployBlock()),
        toBlock: "latest",
      },
    ],
  });
  const parsed = parseEventLogs({
    abi: relayEscrowAbi,
    logs: logs as never,
    eventName: [...DEAL_EVENTS],
  });
  const blocks = [...new Set(parsed.map((log) => log.blockNumber))];
  const timestamps = new Map<bigint, number>();
  await mapLimit(blocks, 5, async (blockNumber) => {
    const block = await client.getBlock({ blockNumber });
    timestamps.set(blockNumber, Number(block.timestamp));
  });
  return parsed.map((log) => ({
    name: log.eventName,
    args: log.args as Record<string, unknown>,
    blockNumber: log.blockNumber,
    transactionHash: log.transactionHash,
    timestamp: timestamps.get(log.blockNumber) ?? 0,
  }));
}

/** Test hook: drop the cached client (after the environment changes). */
export function resetChainClientForTests(): void {
  client = undefined;
}
