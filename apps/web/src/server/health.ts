import "server-only";
import { formatEther } from "viem";
import { publicClient } from "./chain";
import { serverEnv } from "./env";
import { errorFields } from "./log";
import { db } from "./firebaseAdmin";
import { txManager, type SignerRole } from "./signer";

/**
 * Health report for /api/health: RPC reachability and latest block, every server signer's balance
 * (with a low-balance warning), Firestore reachability and the contract addresses. Addresses and
 * balances are public on-chain data; no key, token or secret is ever included.
 */

const CHECK_TIMEOUT_MS = 5_000;

function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out`)), CHECK_TIMEOUT_MS),
    ),
  ]);
}

export interface HealthReport {
  status: "ok" | "degraded" | "down";
  chain: {
    ok: boolean;
    chainId: number;
    latestBlock: string | null;
    blockTime: string | null;
    error?: string;
  };
  firestore: { ok: boolean; error?: string };
  signers: { role: SignerRole; address: string; balanceMstc: string | null; low: boolean }[];
  contracts: { escrow: string; badge: string };
  time: string;
}

export async function healthReport(): Promise<HealthReport> {
  const env = serverEnv();
  const client = publicClient();

  const chain = await withTimeout(client.getBlock({ blockTag: "latest" }), "RPC")
    .then((block) => ({
      ok: true,
      chainId: env.MST_CHAIN_ID,
      latestBlock: block.number.toString(),
      blockTime: new Date(Number(block.timestamp) * 1000).toISOString(),
    }))
    .catch((error) => ({
      ok: false,
      chainId: env.MST_CHAIN_ID,
      latestBlock: null,
      blockTime: null,
      error: String(errorFields(error).errorMessage ?? "unreachable"),
    }));

  const firestore = await withTimeout(db().doc("health/ping").get(), "Firestore")
    .then(() => ({ ok: true }))
    .catch((error) => ({
      ok: false,
      error: String(errorFields(error).errorMessage ?? "unreachable"),
    }));

  // Roles that share a key are reported once (the releaser falls back to the funder).
  const seen = new Set<string>();
  const roles: SignerRole[] = ["verifier", "funder", "releaser"];
  const signers: HealthReport["signers"] = [];
  for (const role of roles) {
    const manager = txManager(role);
    if (seen.has(manager.address)) continue;
    seen.add(manager.address);
    const balance = chain.ok
      ? await withTimeout(manager.balance(), "balance").catch(() => null)
      : null;
    signers.push({
      role,
      address: manager.address,
      balanceMstc: balance === null ? null : formatEther(balance),
      low: balance !== null && balance < env.SIGNER_LOW_BALANCE_WEI,
    });
  }

  const status = !chain.ok
    ? "down"
    : !firestore.ok || signers.some((signer) => signer.low)
      ? "degraded"
      : "ok";
  return {
    status,
    chain,
    firestore,
    signers,
    contracts: { escrow: env.ESCROW_ADDRESS, badge: env.SBT_ADDRESS },
    time: new Date().toISOString(),
  };
}
