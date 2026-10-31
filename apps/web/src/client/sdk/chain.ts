import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  getAddress,
  http,
  isAddress,
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
import { GAS_PRICE_WEI, chainById, relayEscrowAbi } from "@rewardrelay/shared";
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
  /** Browser wallets only: brings the wallet onto the configured chain before a transaction. */
  ensureChain?: () => Promise<void>;
}

export interface TxOutcome {
  hash: Hash;
  receipt: TransactionReceipt;
  explorerUrl: string;
}

const RECEIPT_TIMEOUT_MS = 120_000;
/** MST makes a block about every 3 s; poll at 350 ms to catch inclusion immediately. */
const POLLING_MS = 350;

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
    publicClient: createPublicClient({
      chain,
      transport,
      pollingInterval: POLLING_MS,
    }) as PublicClient,
    walletClient: createWalletClient({ account, chain, transport, pollingInterval: POLLING_MS }),
    account,
  };
}

/**
 * A context signing through a browser wallet (BridgeKey, MetaMask: any EIP-1193 provider). With a
 * known (already connected) address nothing is requested on creation, so a page load never shows a
 * wallet prompt; the wallet is brought onto the MST chain right before each transaction.
 */
export async function injectedChainContext(
  config: ChainConfig,
  provider: EIP1193Provider,
  knownAddress?: Address,
): Promise<ChainContext> {
  const chain = viemChain(config);
  const walletClient = createWalletClient({
    chain,
    transport: custom(provider),
    pollingInterval: POLLING_MS,
  });
  const address = knownAddress ?? (await requestWalletAddress(provider));
  return {
    config,
    chain,
    publicClient: createPublicClient({
      chain,
      transport: http(config.rpcUrl),
      pollingInterval: POLLING_MS,
    }) as PublicClient,
    walletClient,
    account: address,
    ensureChain: () => ensureWalletChain(walletClient, config),
  };
}

/** Asks a browser wallet for its account (shows the wallet's connect prompt if needed). */
export async function requestWalletAddress(provider: EIP1193Provider): Promise<Address> {
  let lastError: unknown;
  try {
    const [address] = await createWalletClient({ transport: custom(provider) }).requestAddresses();
    if (address) return getAddress(address);
  } catch (err) {
    lastError = err;
  }

  const raw = provider as unknown as {
    request: (args: {
      method: string;
      params?: unknown[] | Record<string, unknown>;
    }) => Promise<unknown>;
    selectedAddress?: string;
    address?: string;
    accounts?: string[];
  };
  try {
    const accounts = (await raw.request({ method: "eth_requestAccounts" })) as string[];
    if (accounts && accounts[0]) return getAddress(accounts[0]);
  } catch (err) {
    lastError = err;
    try {
      const accounts = (await raw.request({ method: "eth_accounts" })) as string[];
      if (accounts && accounts[0]) return getAddress(accounts[0]);
    } catch {
      // Fall through to direct property checks
    }
  }

  // Check if provider has active address directly exposed (BridgeKey / custom injected providers)
  if (raw.selectedAddress && isAddress(raw.selectedAddress)) {
    return getAddress(raw.selectedAddress);
  }
  if (raw.address && isAddress(raw.address)) {
    return getAddress(raw.address);
  }
  if (raw.accounts && raw.accounts[0] && isAddress(raw.accounts[0])) {
    return getAddress(raw.accounts[0]);
  }

  if (lastError) {
    const msg = (lastError as { message?: string }).message ?? "";
    const code = (lastError as { code?: number }).code;
    if (code === 4001 || /rejected|denied|cancel/i.test(msg)) {
      throw new ChainError(
        "Connection request was rejected or closed in your wallet.",
        "UserRejected",
      );
    }
    if (code === -32002 || /already pending|pending/i.test(msg)) {
      throw new ChainError(
        "A connection prompt is already pending. Please click the wallet extension icon in your browser toolbar to approve it.",
        "PendingRequest",
      );
    }
  }

  throw new ChainError(
    "Your wallet did not share an account. Please open your BridgeKey or MetaMask extension, unlock it with your password/PIN, and try again.",
    "NoAccount",
  );
}

/**
 * Switches the wallet to the configured chain, adding it first when the wallet does not know it.
 * Wallets need an absolute public RPC URL to add a chain, not the app's same-origin relay path.
 */
export async function ensureWalletChain(
  walletClient: WalletClient,
  config: ChainConfig,
): Promise<void> {
  try {
    const currentChainId = await walletClient.getChainId().catch(() => null);
    if (currentChainId === config.chainId) return;
  } catch {
    // Continue to switch attempt
  }

  try {
    await walletClient.switchChain({ id: config.chainId });
  } catch (error) {
    if (!isUnknownChain(error)) {
      const failure = toChainError(error);
      if (failure.reason) throw failure;
      throw new ChainError(
        `Your wallet could not switch to ${viemChain(config).name}. Switch it by hand (chain id ${config.chainId}), then try again.`,
        "WrongChain",
        undefined,
        error,
      );
    }
    await walletClient.addChain({ chain: publicChain(config) });
    const afterChainId = await walletClient.getChainId().catch(() => null);
    if (afterChainId !== config.chainId) {
      await walletClient.switchChain({ id: config.chainId });
    }
  }
}

/** EIP-3326: 4902 means the wallet does not know the chain (some wallets wrap it in -32603). */
function isUnknownChain(error: unknown): boolean {
  for (
    let current = error as { code?: unknown; cause?: unknown; message?: unknown } | undefined;
    current;
    current = current.cause as typeof current
  ) {
    if (current.code === 4902) return true;
    if (
      typeof current.message === "string" &&
      /unrecognized chain|unknown chain|4902/i.test(current.message)
    )
      return true;
  }
  return false;
}

/** The chain as a wallet should add it: the public RPC from packages/shared when it is known. */
export function publicChain(config: ChainConfig): Chain {
  const known = chainById(config.chainId);
  const rpcUrl = known?.rpcUrls.default.http[0] ?? config.rpcUrl;
  return { ...viemChain(config), rpcUrls: { default: { http: [rpcUrl] } } };
}

export interface InjectedWallet {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: EIP1193Provider;
}

/**
 * Browser wallets: EIP-6963 announcements (several extensions side by side) for `waitMs`, and the
 * legacy `window.ethereum` when nothing announces itself (wallet in-app browsers, older extensions).
 */
export function discoverInjectedWallets(waitMs = 120): Promise<InjectedWallet[]> {
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

      const win = window as unknown as Record<string, unknown>;

      const hasBridgeKey = [...found.values()].some(
        (w) =>
          w.info.name.toLowerCase().includes("bridgekey") ||
          w.info.rdns.toLowerCase().includes("bridgekey"),
      );

      // Check explicit window.bridgekey, window.bridgeKey, window.BridgeKey, or window.mst
      const explicitBridgeKey = (win.bridgekey ??
        win.bridgeKey ??
        win.BridgeKey ??
        win.Bridgekey ??
        win.mst ??
        win.MST ??
        win.mstWallet ??
        win.mstChain) as EIP1193Provider | undefined;

      if (explicitBridgeKey && !hasBridgeKey) {
        found.set("io.bridgekey.wallet", {
          info: {
            uuid: "bridgekey-direct",
            name: "BridgeKey",
            icon: "",
            rdns: "io.bridgekey.wallet",
          },
          provider: explicitBridgeKey,
        });
      }

      // Check window.ethereum.providers array (when multiple extensions coexist)
      const winEth = win.ethereum as
        | (EIP1193Provider & {
            providers?: (EIP1193Provider & {
              isBridgeKey?: boolean;
              bridgeKey?: boolean;
              isMST?: boolean;
              name?: string;
            })[];
            isBridgeKey?: boolean;
            bridgeKey?: boolean;
            isMST?: boolean;
            isMetaMask?: boolean;
            isCoinbaseWallet?: boolean;
          })
        | undefined;

      if (winEth?.providers && Array.isArray(winEth.providers)) {
        for (const p of winEth.providers) {
          const isBk =
            p.isBridgeKey || p.bridgeKey || p.isMST || p.name?.toLowerCase().includes("bridgekey");
          if (isBk && !found.has("io.bridgekey.wallet")) {
            found.set("io.bridgekey.wallet", {
              info: {
                uuid: "bridgekey-provider",
                name: "BridgeKey",
                icon: "",
                rdns: "io.bridgekey.wallet",
              },
              provider: p,
            });
          }
        }
      }

      // Check if window.ethereum itself is BridgeKey or an injected provider. Not when BridgeKey
      // announced itself: window.ethereum may then be another extension under BridgeKey's name.
      if (winEth && !hasBridgeKey && !found.has("io.bridgekey.wallet")) {
        found.set("io.bridgekey.wallet", {
          info: {
            uuid: "bridgekey-injected",
            name: "BridgeKey",
            icon: "",
            rdns: "io.bridgekey.wallet",
          },
          provider: (explicitBridgeKey ?? winEth) as EIP1193Provider,
        });
      }

      // Fallback for legacy window.ethereum when no wallets announced through EIP-6963
      const legacy = winEth;
      if (found.size === 0 && legacy) {
        found.set(LEGACY_WALLET_ID, {
          info: {
            uuid: LEGACY_WALLET_ID,
            name: legacy.isMetaMask
              ? "MetaMask"
              : legacy.isBridgeKey
                ? "BridgeKey"
                : "Browser wallet",
            icon: "",
            rdns: LEGACY_WALLET_ID,
          },
          provider: legacy,
        });
      }
      resolve([...found.values()]);
    }, waitMs),
  );
}

/** The id given to `window.ethereum` when no wallet announces itself through EIP-6963. */
export const LEGACY_WALLET_ID = "injected";

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Waits for the receipt, tolerating failed polls: once the wallet returned a hash the transaction is
 * out, so a relay or network hiccup while polling must never read as a failed transaction.
 */
async function waitForReceipt(ctx: ChainContext, hash: Hash): Promise<TransactionReceipt> {
  const deadline = Date.now() + RECEIPT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const receipt = await ctx.publicClient.getTransactionReceipt({ hash }).catch(() => null);
    if (receipt) return receipt;
    await sleep(POLLING_MS);
  }
  throw new ChainError(
    "The network is slow. Check the transaction on mstscan before retrying.",
    "Timeout",
    hash,
  );
}

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
    await Promise.all([ctx.ensureChain?.(), ctx.publicClient.simulateContract(call)]);
    hash = await ctx.walletClient.writeContract({
      ...(call as object),
      chain: ctx.chain,
      type: "legacy",
      gasPrice: GAS_PRICE_WEI,
    } as never);
    const receipt = await waitForReceipt(ctx, hash);
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
    await ctx.ensureChain?.();
    hash = await ctx.walletClient.sendTransaction({
      account: ctx.account,
      chain: ctx.chain,
      to,
      value,
      type: "legacy",
      gasPrice: GAS_PRICE_WEI,
    } as never);
    const receipt = await waitForReceipt(ctx, hash);
    if (receipt.status !== "success")
      throw new ChainError("The transfer failed.", "Reverted", hash);
    return { hash, receipt, explorerUrl: explorerTx(ctx, hash) };
  } catch (error) {
    throw toChainError(error, hash);
  }
}
