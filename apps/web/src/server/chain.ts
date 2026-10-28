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
import {
  DealStatus,
  TERMINAL_STATUSES,
  chainById,
  deployments,
  relayEscrowAbi,
  reputationSbtAbi,
} from "@rewardrelay/shared";
import { TtlCache } from "./cache";
import { withDeadline } from "./deadline";
import { serverEnv, type ServerEnv } from "./env";
import { track } from "./timing";

/**
 * Read access to MST through viem. The chain definition comes from packages/shared and is pointed
 * at the configured RPC URL, so the same code serves MST Testnet and a local Hardhat node.
 */

/** Per attempt (a read is also bounded as a whole by CHAIN_CALL_DEADLINE_MS). */
const RPC_TIMEOUT_MS = 8_000;
const RPC_RETRIES = 2;
const RPC_RETRY_DELAY_MS = 250;
/** Upper bound for one read, retries included: an RPC outage answers "temporarily unavailable". */
const CHAIN_CALL_DEADLINE_MS = 9_000;

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

/**
 * HTTP transport with timeout and exponential retry (viem retries network errors and 5xx/429).
 * Every call is reported to the request timing as `chain`.
 */
export function rpcTransport(env: ServerEnv = serverEnv()): Transport {
  const inner = http(env.MST_RPC_URL, {
    timeout: RPC_TIMEOUT_MS,
    retryCount: RPC_RETRIES,
    retryDelay: RPC_RETRY_DELAY_MS,
    // MST has no Multicall3; concurrent reads are grouped into JSON-RPC batches instead.
    batch: { batchSize: 25, wait: 10 },
  });
  return ((params) => {
    const transport = inner(params);
    const request = ((args: { method: string }, options?: unknown) => {
      const call = transport.request(args as never, options as never);
      // A hung node must not hold a request for every retry; a broadcast is never cut short (the
      // signer would not know whether the transaction left).
      const bounded =
        args.method === "eth_sendRawTransaction"
          ? call
          : withDeadline(call, CHAIN_CALL_DEADLINE_MS, `chain.${args.method}`);
      return track("chain", bounded);
    }) as typeof transport.request;
    return { ...transport, request };
  }) as Transport;
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

const dealCache = new TtlCache<OnChainDeal>({ ttlMs: 3_000, max: 2_000 });
const terminalDealCache = new TtlCache<OnChainDeal>({
  ttlMs: Number.POSITIVE_INFINITY,
  max: 5_000,
});

/**
 * The deal as stored on-chain. Unknown ids revert with `DealNotFound`.
 * Active deals are cached for 3 s; terminal deals (Completed, Refunded, Resolved, Cancelled)
 * are cached indefinitely since on-chain deal state never changes once finalized.
 */
export async function readDeal(
  id: bigint,
  options: { fresh?: boolean } = {},
): Promise<OnChainDeal> {
  const key = id.toString();
  if (!options.fresh) {
    const terminal = terminalDealCache.peek(key);
    if (terminal) return terminal;
    return dealCache.get(key, async () => {
      const deal = await escrowContract().read.getDeal([id]);
      if (TERMINAL_STATUSES.includes(deal.status as DealStatus)) {
        terminalDealCache.set(key, deal);
      }
      return deal;
    });
  }
  const deal = await escrowContract().read.getDeal([id]);
  if (TERMINAL_STATUSES.includes(deal.status as DealStatus)) {
    terminalDealCache.set(key, deal);
  } else {
    dealCache.set(key, deal);
  }
  return deal;
}

/** Drop any cached deal record and scanned events (after a mutation). */
export function invalidateDealCache(id: bigint | string): void {
  const key = id.toString();
  dealCache.invalidate(key);
  terminalDealCache.invalidate(key);
  dealEvents.delete(key);
}

/**
 * Trust summaries change only when a deal ends; displays of other people's badges (feed, deal room,
 * badge page) reuse a read for a few seconds. A user's own view and limit checks read fresh.
 */
const trustCache = new TtlCache<TrustSummary>({ ttlMs: 10_000, max: 5_000 });

export function readTrust(
  account: Address,
  options: { fresh?: boolean } = {},
): Promise<TrustSummary> {
  const load = async (): Promise<TrustSummary> => {
    const [hasBadge, tier, completed, disputesLost, relayPoints, maxDealValue] =
      await sbtContract().read.trustOf([account]);
    return { hasBadge, tier, completed, disputesLost, relayPoints, maxDealValue };
  };
  const key = account.toLowerCase();
  return options.fresh ? trustCache.refresh(key, load) : trustCache.get(key, load);
}

/** Call after the server itself changes an account's badge (mint, ruling). */
export function invalidateTrust(account: Address): void {
  trustCache.invalidate(account.toLowerCase());
}

const pausedCache = new TtlCache<boolean>({ ttlMs: 10_000, max: 1 });

/** Whether new escrow commitments are paused (exits never are). */
export function escrowPaused(): Promise<boolean> {
  return pausedCache.get("paused", () => escrowContract().read.paused());
}

export interface LatestBlock {
  number: bigint;
  timestamp: number;
}

/** MST makes a block about every 3 s, so the latest block is shared for up to 2.5 s. */
const latestCache = new TtlCache<LatestBlock>({ ttlMs: 2_500, max: 1 });

export function latestBlock(): Promise<LatestBlock> {
  return latestCache.get("latest", async () => {
    const block = await publicClient().getBlock({ blockTag: "latest" });
    return { number: block.number, timestamp: Number(block.timestamp) };
  });
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

/** A block's timestamp never changes. */
const blockTimes = new TtlCache<number>({ ttlMs: Number.POSITIVE_INFINITY, max: 20_000 });

function blockTime(blockNumber: bigint): Promise<number> {
  return blockTimes.get(blockNumber.toString(), async () =>
    Number((await publicClient().getBlock({ blockNumber })).timestamp),
  );
}

/**
 * Deal events are append-only, so each deal keeps the events read so far and a block they are known
 * to be complete up to; a later read only scans from there (REORG_MARGIN blocks back, so a short
 * reorganisation is picked up) to the node's latest block, so a new event is never missed.
 */
const REORG_MARGIN = 3n;
const DEAL_EVENT_CACHE_MAX = 2_000;
const dealEvents = new Map<string, { events: DealEvent[]; scannedTo: bigint }>();
const dealEventsInFlight = new Map<string, Promise<DealEvent[]>>();

const TERMINAL_EVENTS = new Set(["Completed", "Refunded", "ListingCancelled", "DisputeResolved"]);

/** Every escrow event of one deal, oldest first, with block timestamps. */
export function readDealEvents(id: bigint): Promise<DealEvent[]> {
  const key = id.toString();
  const cached = dealEvents.get(key);
  if (cached && cached.events.some((event) => TERMINAL_EVENTS.has(event.name))) {
    return Promise.resolve(cached.events);
  }
  const pending = dealEventsInFlight.get(key);
  if (pending) return pending;
  const call = scanDealEvents(id, key).finally(() => dealEventsInFlight.delete(key));
  dealEventsInFlight.set(key, call);
  return call;
}

async function scanDealEvents(id: bigint, key: string): Promise<DealEvent[]> {
  const cached = dealEvents.get(key);
  if (cached && cached.events.some((event) => TERMINAL_EVENTS.has(event.name))) {
    return cached.events;
  }

  // A lower bound of the head (shared for up to 2.5 s): the scan below reads to "latest", so every
  // block up to `known` is covered by it.
  const known = (await latestBlock()).number;
  if (cached && known <= cached.scannedTo) {
    return cached.events;
  }

  const deployBlock = escrowDeployBlock();
  const resume = cached ? cached.scannedTo - REORG_MARGIN + 1n : deployBlock;
  const fromBlock = resume > deployBlock ? resume : deployBlock;
  const logs = await publicClient().request({
    method: "eth_getLogs",
    params: [
      {
        address: serverEnv().ESCROW_ADDRESS,
        topics: [DEAL_EVENT_TOPICS, pad(toHex(id), { size: 32 })],
        fromBlock: toHex(fromBlock),
        toBlock: "latest",
      },
    ],
  });
  const parsed = parseEventLogs({
    abi: relayEscrowAbi,
    logs: logs as never,
    eventName: [...DEAL_EVENTS],
  });

  const uniqueBlockNumbers = [...new Set(parsed.map((log) => log.blockNumber))];
  const timestamps = new Map<bigint, number>();
  await Promise.all(
    uniqueBlockNumbers.map(async (bn) => {
      timestamps.set(bn, await blockTime(bn));
    }),
  );
  const fresh = parsed.map((log) => ({
    name: log.eventName,
    args: log.args as Record<string, unknown>,
    blockNumber: log.blockNumber,
    transactionHash: log.transactionHash,
    timestamp: timestamps.get(log.blockNumber) ?? 0,
  }));

  const events = [
    ...(cached?.events.filter((event) => event.blockNumber < fromBlock) ?? []),
    ...fresh,
  ];

  dealEvents.delete(key);
  if (dealEvents.size >= DEAL_EVENT_CACHE_MAX) {
    const oldest = dealEvents.keys().next().value;
    if (oldest !== undefined) dealEvents.delete(oldest);
  }
  dealEvents.set(key, { events, scannedTo: known });
  return events;
}

/** Test hook: drop the cached client and every chain cache (after the environment changes). */
export function resetChainClientForTests(): void {
  client = undefined;
  resetChainCaches();
}

/** Drops every cached chain read (tests that move the local chain's clock call this). */
export function resetChainCaches(): void {
  trustCache.invalidate();
  pausedCache.invalidate();
  latestCache.invalidate();
  blockTimes.invalidate();
  dealCache.invalidate();
  terminalDealCache.invalidate();
  dealEvents.clear();
}
