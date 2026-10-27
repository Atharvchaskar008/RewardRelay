import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  http,
  parseEventLogs,
  zeroHash,
  type Account,
  type Address,
  type Chain,
  type EIP1193Provider,
  type Hash,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
} from "viem";
import { GAS_PRICE_WEI, chainById, relayEscrowAbi } from "rewardrelay-shared";
import { ChainError, toChainError } from "./errors";

/**
 * Client-side chain access. Every escrow call is simulated first (a revert surfaces as a readable
 * ChainError before anything is signed), then sent as a legacy transaction at the fixed MST gas price
 * of 1 gwei, then awaited to its receipt. Works with the embedded wallet (a viem local account) or an
 * injected wallet such as BridgeKey or MetaMask (discovered through EIP-6963).
 */

export interface ChainConfig {
  chainId: number;
  /** JSON-RPC URL; in the browser use the same-origin proxy (`/api/rpc/testnet`) to avoid CORS. */
  rpcUrl: string;
  explorerUrl: string;
  escrow: Address;
}

export interface ChainContext {
  config: ChainConfig;
  chain: Chain;
  publicClient: PublicClient;
  walletClient: WalletClient;
  account: Account | Address;
}

export interface TxOutcome {
  hash: Hash;
  receipt: TransactionReceipt;
  explorerUrl: string;
}

const RECEIPT_TIMEOUT_MS = 120_000;

export function viemChain(config: ChainConfig): Chain {
  const known = chainById(config.chainId);
  return defineChain({
    id: config.chainId,
    name: known?.name ?? `Chain ${config.chainId}`,
    nativeCurrency: known?.nativeCurrency ?? { name: "MST Coin", symbol: "MSTC", decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
    blockExplorers: { default: { name: "MSTScan", url: config.explorerUrl } },
  });
}

/** A context signing with a local account (the embedded wallet's `getAccount()`). */
export function chainContext(config: ChainConfig, account: Account): ChainContext {
  const chain = viemChain(config);
  const transport = http(config.rpcUrl, { retryCount: 2, timeout: 15_000 });
  return {
    config,
    chain,
    publicClient: createPublicClient({ chain, transport }) as PublicClient,
    walletClient: createWalletClient({ account, chain, transport }),
    account,
  };
}

/** A context signing through an injected EIP-1193 wallet (switches/adds the MST chain first). */
export async function injectedChainContext(
  config: ChainConfig,
  provider: EIP1193Provider,
): Promise<ChainContext> {
  const chain = viemChain(config);
  const walletClient = createWalletClient({ chain, transport: custom(provider) });
  const [address] = await walletClient.requestAddresses();
  try {
    await walletClient.switchChain({ id: chain.id });
  } catch {
    await walletClient.addChain({ chain });
  }
  return {
    config,
    chain,
    publicClient: createPublicClient({ chain, transport: http(config.rpcUrl) }) as PublicClient,
    walletClient,
    account: address,
  };
}

export interface InjectedWallet {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: EIP1193Provider;
}

/** EIP-6963 discovery: wallets announce themselves for `waitMs` after the request. */
export function discoverInjectedWallets(waitMs = 400): Promise<InjectedWallet[]> {
  if (typeof window === "undefined") return Promise.resolve([]);
  const found = new Map<string, InjectedWallet>();
  const onAnnounce = (event: Event) => {
    const detail = (event as CustomEvent<InjectedWallet>).detail;
    if (detail?.info?.uuid) found.set(detail.info.uuid, detail);
  };
  window.addEventListener("eip6963:announceProvider", onAnnounce);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  return new Promise((resolve) =>
    setTimeout(() => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      resolve([...found.values()]);
    }, waitMs),
  );
}

export function accountAddress(ctx: ChainContext): Address {
  return typeof ctx.account === "string" ? ctx.account : ctx.account.address;
}

export const explorerTx = (ctx: ChainContext, hash: Hash) =>
  `${ctx.config.explorerUrl.replace(/\/$/, "")}/tx/${hash}`;

type EscrowFunction =
  | "createListing"
  | "cancelListing"
  | "acceptListing"
  | "markDelivered"
  | "confirmReceipt"
  | "release"
  | "claimTimeout"
  | "raiseDispute"
  | "addEvidence"
  | "defaultResolve"
  | "withdraw";

async function sendEscrow(
  ctx: ChainContext,
  functionName: EscrowFunction,
  args: unknown[],
  value?: bigint,
): Promise<TxOutcome> {
  const call = {
    address: ctx.config.escrow,
    abi: relayEscrowAbi,
    functionName,
    args,
    value,
    account: ctx.account,
  } as never;
  let hash: Hash | undefined;
  try {
    await ctx.publicClient.simulateContract(call);
    hash = await ctx.walletClient.writeContract({
      ...(call as object),
      chain: ctx.chain,
      type: "legacy",
      gasPrice: GAS_PRICE_WEI,
    } as never);
    const receipt = await ctx.publicClient.waitForTransactionReceipt({
      hash,
      timeout: RECEIPT_TIMEOUT_MS,
    });
    if (receipt.status !== "success")
      throw new ChainError("The transaction failed on-chain.", "Reverted", hash);
    return { hash, receipt, explorerUrl: explorerTx(ctx, hash) };
  } catch (error) {
    throw toChainError(error, hash);
  }
}

export async function readDeal(ctx: ChainContext, id: bigint) {
  return ctx.publicClient.readContract({
    address: ctx.config.escrow,
    abi: relayEscrowAbi,
    functionName: "getDeal",
    args: [id],
  });
}

export async function requiredSharerDeposit(ctx: ChainContext, price: bigint): Promise<bigint> {
  return ctx.publicClient.readContract({
    address: ctx.config.escrow,
    abi: relayEscrowAbi,
    functionName: "requiredSharerDeposit",
    args: [accountAddress(ctx), price],
  });
}

export async function withdrawable(ctx: ChainContext): Promise<bigint> {
  return ctx.publicClient.readContract({
    address: ctx.config.escrow,
    abi: relayEscrowAbi,
    functionName: "withdrawable",
    args: [accountAddress(ctx)],
  });
}

/** createListing (deposit read from the contract) → the new deal id. */
export async function createListing(
  ctx: ChainContext,
  params: {
    categoryId: number;
    price: bigint;
    eventTime: bigint;
    termsHash: Hex;
    fingerprint?: Hex;
    auth?: { nonce: bigint; deadline: bigint; signature: Hex };
  },
): Promise<TxOutcome & { dealId: bigint }> {
  const deposit = await requiredSharerDeposit(ctx, params.price);
  const outcome = await sendEscrow(
    ctx,
    "createListing",
    [
      params.categoryId,
      params.price,
      params.eventTime,
      params.termsHash,
      params.fingerprint ?? zeroHash,
      params.auth ?? { nonce: 0n, deadline: 0n, signature: "0x" },
    ],
    deposit,
  );
  const [created] = parseEventLogs({
    abi: relayEscrowAbi,
    logs: outcome.receipt.logs,
    eventName: "ListingCreated",
  });
  if (!created)
    throw new ChainError(
      "The listing was created but its id could not be read.",
      undefined,
      outcome.hash,
    );
  return { ...outcome, dealId: created.args.id };
}

/** acceptListing with exactly price + seeker deposit (read from the deal). */
export async function acceptListing(ctx: ChainContext, id: bigint): Promise<TxOutcome> {
  const deal = await readDeal(ctx, id);
  return sendEscrow(ctx, "acceptListing", [id], deal.price + deal.seekerDeposit);
}

export const cancelListing = (ctx: ChainContext, id: bigint) =>
  sendEscrow(ctx, "cancelListing", [id]);
export const markDelivered = (ctx: ChainContext, id: bigint, proofHash: Hex) =>
  sendEscrow(ctx, "markDelivered", [id, proofHash]);
export const confirmReceipt = (ctx: ChainContext, id: bigint) =>
  sendEscrow(ctx, "confirmReceipt", [id]);
export const release = (ctx: ChainContext, id: bigint) => sendEscrow(ctx, "release", [id]);
export const claimTimeout = (ctx: ChainContext, id: bigint) =>
  sendEscrow(ctx, "claimTimeout", [id]);
export const raiseDispute = (ctx: ChainContext, id: bigint, evidenceHash: Hex) =>
  sendEscrow(ctx, "raiseDispute", [id, evidenceHash]);
export const addEvidence = (ctx: ChainContext, id: bigint, evidenceHash: Hex) =>
  sendEscrow(ctx, "addEvidence", [id, evidenceHash]);
export const defaultResolve = (ctx: ChainContext, id: bigint) =>
  sendEscrow(ctx, "defaultResolve", [id]);
export const withdraw = (ctx: ChainContext) => sendEscrow(ctx, "withdraw", []);

/** A plain MSTC transfer (wallet "send"), legacy at 1 gwei. */
export async function sendMstc(ctx: ChainContext, to: Address, value: bigint): Promise<TxOutcome> {
  let hash: Hash | undefined;
  try {
    hash = await ctx.walletClient.sendTransaction({
      account: ctx.account,
      chain: ctx.chain,
      to,
      value,
      type: "legacy",
      gasPrice: GAS_PRICE_WEI,
    } as never);
    const receipt = await ctx.publicClient.waitForTransactionReceipt({
      hash,
      timeout: RECEIPT_TIMEOUT_MS,
    });
    if (receipt.status !== "success")
      throw new ChainError("The transfer failed.", "Reverted", hash);
    return { hash, receipt, explorerUrl: explorerTx(ctx, hash) };
  } catch (error) {
    throw toChainError(error, hash);
  }
}
