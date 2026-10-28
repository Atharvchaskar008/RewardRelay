import { ethers } from "ethers";
import type { Signer, TransactionReceipt, TransactionRequest } from "ethers";
import type { DeploymentRecord, TxRecord } from "./records";
import { writeRecord } from "./records";

/** MST has no base fee: every transaction is a legacy (type 0) transaction at a fixed 1 gwei. */
export const GAS_PRICE = ethers.parseUnits("1", "gwei");

const RECEIPT_TIMEOUT_MS = 180_000;
/** Gas limit = estimate + 20%; the cap is checked against this upper bound, not the estimate. */
const GAS_MARGIN_DIVISOR = 5n;

const EXPLORERS: Record<number, string> = {
  91562037: "https://testnet.mstscan.com",
  4646: "https://mstscan.com",
};

export function explorerUrl(chainId: number, kind: "tx" | "address", value: string): string {
  const base = EXPLORERS[chainId];
  return base ? `${base}/${kind}/${value}` : `(local ${kind}) ${value}`;
}

/** Amounts as MSTC on mainnet and tMSTC elsewhere (Hardhat sets HARDHAT_NETWORK for scripts). */
export const formatMstc = (wei: bigint): string =>
  `${ethers.formatEther(wei)} ${process.env.HARDHAT_NETWORK === "mstMainnet" ? "MSTC" : "tMSTC"}`;

export interface SpendCaps {
  /** Gas plus value leaving our wallets, summed over every recorded transaction. */
  spendCapWei: bigint;
  /** Value moved from the deployer to our own generated wallets. */
  transferCapWei: bigint;
}

function weiFromEnv(name: string, fallback: string): bigint {
  const value = process.env[name]?.trim() || fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be an integer amount in wei.`);
  return BigInt(value);
}

export function loadCaps(): SpendCaps {
  return {
    spendCapWei: weiFromEnv("SPEND_CAP_WEI", ethers.parseEther("0.02").toString()),
    transferCapWei: weiFromEnv("TRANSFER_CAP_WEI", ethers.parseEther("0.015").toString()),
  };
}

export function spentSoFar(record: DeploymentRecord): { spendWei: bigint; transferWei: bigint } {
  let spendWei = 0n;
  let transferWei = 0n;
  for (const tx of record.transactions) {
    spendWei += BigInt(tx.gasCostWei);
    if (tx.kind === "transfer") transferWei += BigInt(tx.valueWei);
    else spendWei += BigInt(tx.valueWei);
  }
  return { spendWei, transferWei };
}

export class BudgetExceededError extends Error {}

export interface SendOptions {
  record: DeploymentRecord;
  caps: SpendCaps;
  label: string;
  kind: TxRecord["kind"];
  signer: Signer;
  request: TransactionRequest;
  /** Called with the hash as soon as the transaction is broadcast (before the receipt). */
  onSent?: (hash: string) => void;
}

/**
 * Estimates, checks the spend caps, broadcasts a legacy 1 gwei transaction, waits for the receipt
 * and appends it to the deployment record. Value sent to a contract counts as spend (conservative:
 * escrowed deposits come back, but the cap does not assume it); value of a "transfer" counts
 * against the transfer cap instead.
 */
export async function sendTx(options: SendOptions): Promise<TransactionReceipt> {
  const { record, caps, label, kind, signer, request } = options;
  const from = await signer.getAddress();
  const tx: TransactionRequest = { ...request, from, type: 0, gasPrice: GAS_PRICE };

  const estimate = await signer.estimateGas(tx);
  const gasLimit = estimate + estimate / GAS_MARGIN_DIVISOR;
  const maxGasCost = gasLimit * GAS_PRICE;
  const value = BigInt(request.value ?? 0);
  const spent = spentSoFar(record);

  const projectedSpend = spent.spendWei + maxGasCost + (kind === "transfer" ? 0n : value);
  if (projectedSpend > caps.spendCapWei) {
    throw new BudgetExceededError(
      `${label}: estimated ${estimate} gas would raise the spend to ${formatMstc(projectedSpend)}, ` +
        `above the cap of ${formatMstc(caps.spendCapWei)}. Not broadcast.`,
    );
  }
  if (kind === "transfer" && spent.transferWei + value > caps.transferCapWei) {
    throw new BudgetExceededError(
      `${label}: transfers would reach ${formatMstc(spent.transferWei + value)}, above the cap of ` +
        `${formatMstc(caps.transferCapWei)}. Not broadcast.`,
    );
  }

  console.log(`  → ${label}: estimate ${estimate} gas (max ${formatMstc(maxGasCost)})`);
  const response = await signer.sendTransaction({ ...tx, gasLimit });
  options.onSent?.(response.hash);
  const receipt = await response.wait(1, RECEIPT_TIMEOUT_MS);
  if (!receipt || receipt.status !== 1)
    throw new Error(`${label}: transaction ${response.hash} failed`);

  const gasCost = receipt.gasUsed * (receipt.gasPrice ?? GAS_PRICE);
  record.transactions.push({
    label,
    hash: receipt.hash,
    from,
    to: receipt.to ?? receipt.contractAddress ?? null,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    gasCostWei: gasCost.toString(),
    valueWei: value.toString(),
    kind,
  });
  writeRecord(record);
  console.log(
    `    ✓ ${receipt.gasUsed} gas, block ${receipt.blockNumber}: ${explorerUrl(record.chainId, "tx", receipt.hash)}`,
  );
  return receipt;
}
