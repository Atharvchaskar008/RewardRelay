import "server-only";
import {
  encodeFunctionData,
  keccak256,
  type Abi,
  type Address,
  type Chain,
  type ContractFunctionArgs,
  type ContractFunctionName,
  type Hash,
  type Hex,
  type PrivateKeyAccount,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { GAS_PRICE_WEI } from "@rewardrelay/shared";
import { mstChain, publicClient } from "./chain";
import { serverEnv } from "./env";
import { AppError } from "./errors";
import { log } from "./log";

/**
 * Server transaction manager, one per signer address:
 * - legacy (type 0) transactions at the fixed MST gas price of 1 gwei;
 * - a mutex around nonce allocation, signing and broadcast, so concurrent requests in one process
 *   never reuse a nonce (other processes are handled by resyncing on "nonce too low");
 * - local signing: the hash is known before broadcast, so a network error is retried by resending
 *   the *same* raw transaction (idempotent) instead of creating a second one;
 * - exponential backoff on nonce, underpriced and network errors; anything else fails fast;
 * - receipt wait with a timeout, returning a structured result.
 */

export interface TxResult {
  hash: Hash;
  status: "success" | "reverted";
  blockNumber: bigint;
  gasUsed: bigint;
}

export interface TxRequest {
  to: Address;
  data?: Hex;
  value?: bigint;
  /** Gas limit; estimated (+20%) when omitted. */
  gas?: bigint;
}

type ErrorKind = "nonce" | "known" | "underpriced" | "network" | "funds" | "fatal";

/** Classifies an RPC/viem error by its message chain (providers word these differently). */
export function classifyTxError(error: unknown): ErrorKind {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current && depth < 6; depth++) {
    if (current instanceof Error) {
      parts.push(current.name, current.message);
      const details = (current as { details?: unknown }).details;
      if (typeof details === "string") parts.push(details);
      current = (current as { cause?: unknown }).cause;
    } else {
      parts.push(String(current));
      break;
    }
  }
  const text = parts.join(" ").toLowerCase();
  if (/already known|known transaction|alreadyknown|transaction already imported/.test(text)) {
    return "known";
  }
  if (
    /nonce too low|nonce has already been used|invalid nonce|nonce is too low|oldnonce/.test(text)
  ) {
    return "nonce";
  }
  if (/insufficient funds/.test(text)) return "funds";
  if (/underpriced|fee too low|gas price too low|replacement transaction/.test(text)) {
    return "underpriced";
  }
  if (/execution reverted|revert/.test(text)) return "fatal";
  if (
    /timeout|timed out|fetch failed|econnreset|econnrefused|enotfound|socket|network|http request failed|429|502|503|504|rate limit/.test(
      text,
    )
  ) {
    return "network";
  }
  return "fatal";
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface TxManagerOptions {
  account: PrivateKeyAccount;
  client: PublicClient;
  chain: Chain;
  label: string;
  maxAttempts?: number;
  baseDelayMs?: number;
  receiptTimeoutMs?: number;
  gasPrice?: bigint;
}

export class TxManager {
  readonly address: Address;
  readonly label: string;
  private readonly account: PrivateKeyAccount;
  private readonly client: PublicClient;
  private readonly chain: Chain;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly receiptTimeoutMs: number;
  private readonly gasPrice: bigint;
  private queue: Promise<unknown> = Promise.resolve();
  private nextNonce: number | undefined;

  constructor(options: TxManagerOptions) {
    this.account = options.account;
    this.address = options.account.address;
    this.client = options.client;
    this.chain = options.chain;
    this.label = options.label;
    this.maxAttempts = options.maxAttempts ?? 4;
    this.baseDelayMs = options.baseDelayMs ?? 400;
    this.receiptTimeoutMs = options.receiptTimeoutMs ?? 90_000;
    this.gasPrice = options.gasPrice ?? GAS_PRICE_WEI;
  }

  /** Runs `task` after every previously queued task has settled (a FIFO mutex). */
  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Signs and broadcasts, then waits for the receipt (outside the lock). */
  async send(request: TxRequest): Promise<TxResult> {
    const hash = await this.exclusive(() => this.broadcast(request));
    return this.waitForReceipt(hash);
  }

  /** Simulates (surfacing the revert reason before any gas is spent), then sends. */
  async writeContract<
    const abi extends Abi,
    functionName extends ContractFunctionName<abi, "nonpayable" | "payable">,
  >(call: {
    address: Address;
    abi: abi;
    functionName: functionName;
    args: ContractFunctionArgs<abi, "nonpayable" | "payable", functionName>;
    value?: bigint;
  }): Promise<TxResult> {
    const { address, abi, functionName, args, value } = call;
    try {
      await this.client.simulateContract({
        account: this.account,
        address,
        abi,
        functionName,
        args,
        value,
      } as never);
    } catch (error) {
      throw new AppError("TX_FAILED", {
        message: "The blockchain rejected this action.",
        cause: error,
        details: { reason: revertName(error) },
      });
    }
    const data = encodeFunctionData({ abi, functionName, args } as never);
    return this.send({ to: address, data, value });
  }

  private async broadcast(request: TxRequest): Promise<Hash> {
    let signed: { raw: Hex; hash: Hash; nonce: number } | undefined;
    for (let attempt = 1; ; attempt++) {
      try {
        if (!signed) signed = await this.sign(request);
        await this.client.sendRawTransaction({ serializedTransaction: signed.raw });
        this.nextNonce = signed.nonce + 1;
        return signed.hash;
      } catch (error) {
        const kind = classifyTxError(error);
        if (kind === "known" && signed) {
          this.nextNonce = signed.nonce + 1;
          return signed.hash;
        }
        if (kind === "nonce" && signed) {
          // Another process may have mined our raw transaction already.
          const mined = await this.client.getTransaction({ hash: signed.hash }).catch(() => null);
          if (mined) {
            this.nextNonce = signed.nonce + 1;
            return signed.hash;
          }
        }
        if (kind === "funds") {
          throw new AppError("TX_FAILED", {
            message: "The server wallet cannot pay for gas right now.",
            cause: error,
          });
        }
        if (kind === "fatal" || attempt >= this.maxAttempts) {
          throw new AppError("TX_FAILED", { cause: error, details: { attempts: attempt } });
        }
        if (kind === "nonce" || kind === "underpriced") {
          // Re-read the pending nonce and sign a fresh transaction on the next attempt.
          this.nextNonce = undefined;
          signed = undefined;
        }
        const delay = this.baseDelayMs * 2 ** (attempt - 1) + Math.floor(Math.random() * 100);
        log("warn", "tx.retry", { signer: this.label, attempt, kind, delayMs: delay });
        await sleep(delay);
      }
    }
  }

  private async sign(request: TxRequest): Promise<{ raw: Hex; hash: Hash; nonce: number }> {
    const nonce =
      this.nextNonce ??
      (await this.client.getTransactionCount({ address: this.address, blockTag: "pending" }));
    const gas =
      request.gas ??
      ((await this.client.estimateGas({
        account: this.address,
        to: request.to,
        data: request.data,
        value: request.value,
      })) *
        12n) /
        10n;
    const raw = await this.account.signTransaction({
      type: "legacy",
      chainId: this.chain.id,
      nonce,
      to: request.to,
      data: request.data,
      value: request.value ?? 0n,
      gas,
      gasPrice: this.gasPrice,
    });
    return { raw, hash: keccak256(raw), nonce };
  }

  private async waitForReceipt(hash: Hash): Promise<TxResult> {
    try {
      const receipt = await this.client.waitForTransactionReceipt({
        hash,
        timeout: this.receiptTimeoutMs,
        pollingInterval: 1_000,
      });
      const result: TxResult = {
        hash,
        status: receipt.status,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed,
      };
      log("info", "tx.mined", {
        signer: this.label,
        hash,
        status: result.status,
        blockNumber: result.blockNumber.toString(),
        gasUsed: result.gasUsed.toString(),
      });
      return result;
    } catch (error) {
      throw new AppError("TX_FAILED", {
        message: "The transaction was sent but not confirmed in time.",
        cause: error,
        details: { hash },
      });
    }
  }

  /** Current native balance of this signer (used by the health check). */
  balance(): Promise<bigint> {
    return this.client.getBalance({ address: this.address });
  }
}

/** Best-effort custom-error name from a viem contract error (e.g. "InvalidStatus"). */
export function revertName(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; current && depth < 8; depth++) {
    const errObj = current as {
      data?: { errorName?: unknown };
      errorName?: unknown;
      message?: string;
      errors?: unknown[];
      cause?: unknown;
    };
    if (typeof errObj.data?.errorName === "string") return errObj.data.errorName;
    if (typeof errObj.errorName === "string") return errObj.errorName;

    if (Array.isArray(errObj.errors)) {
      for (const inner of errObj.errors) {
        const found = revertName(inner);
        if (found) return found;
      }
    }

    if (errObj.message) {
      const match =
        errObj.message.match(/reverted with custom error ['"]([^'"]+)['"]/i) ||
        errObj.message.match(
          /\b(DealNotFound|InvalidStatus|Unauthorized|PriceMismatch|TermsMismatch|FeeMismatch|SelfDeal|BadgeRequired|TierLimitExceeded|CannotCancelYet|EvidenceWindowClosed|AlreadyDelivered|AlreadyResolved)\b/,
        );
      if (match) return match[1];
    }

    current = errObj.cause;
  }
  return undefined;
}

export type SignerRole = "verifier" | "funder" | "releaser";

const managers = new Map<Address, TxManager>();

/**
 * The transaction manager for a server role. VERIFIER also holds ARBITER_ROLE; the releaser falls
 * back to the funder key. Managers are shared per address, so roles that share a key share a nonce.
 */
export function txManager(role: SignerRole): TxManager {
  const env = serverEnv();
  const key =
    role === "verifier"
      ? env.VERIFIER_PRIVATE_KEY
      : role === "funder"
        ? env.FUNDER_PRIVATE_KEY
        : (env.RELEASER_PRIVATE_KEY ?? env.FUNDER_PRIVATE_KEY);
  const account = privateKeyToAccount(key);
  let manager = managers.get(account.address);
  if (!manager) {
    manager = new TxManager({ account, client: publicClient(), chain: mstChain(), label: role });
    managers.set(account.address, manager);
  }
  return manager;
}

/** Test hook: forget cached managers (after the environment changes). */
export function resetTxManagersForTests(): void {
  managers.clear();
}
