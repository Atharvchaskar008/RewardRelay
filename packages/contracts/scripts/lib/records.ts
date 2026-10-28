import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";

/**
 * Deployment records: `deployments/<network>.json` for public networks (committed) and
 * `deployments/<network>.local.json` for local nodes (git-ignored). Every script writes the record
 * right after each transaction, so an interrupted run resumes where it stopped.
 */

export interface ContractRecord {
  address: string;
  txHash: string;
  blockNumber: number;
  constructorArguments: string[];
}

export interface TxRecord {
  label: string;
  hash: string;
  from: string;
  to: string | null;
  blockNumber: number;
  gasUsed: string;
  gasCostWei: string;
  valueWei: string;
  /** "transfer" = value moved between our own wallets (counted against the transfer cap). */
  kind: "deploy" | "config" | "transfer" | "smoke";
}

export interface DeploymentRecord {
  network: string;
  chainId: number;
  deployer: string;
  commit: string;
  updatedAt: string;
  contracts: Record<string, ContractRecord>;
  /** A sent but unconfirmed deployment, adopted from its receipt on the next run. */
  pending: Record<string, { txHash: string }>;
  configuration?: Record<string, unknown>;
  verification?: Record<string, unknown>;
  smoke?: Record<string, unknown>;
  transactions: TxRecord[];
}

export const DEPLOYMENTS_DIR = path.join(__dirname, "..", "..", "deployments");

const LOCAL_NETWORKS = new Set(["hardhat", "localhost"]);

export function isLocalNetwork(network: string): boolean {
  return LOCAL_NETWORKS.has(network);
}

export function recordPath(network: string): string {
  const suffix = isLocalNetwork(network) ? ".local.json" : ".json";
  return path.join(DEPLOYMENTS_DIR, `${network}${suffix}`);
}

/** Commit SHA of the code being deployed, with `-dirty` when tracked files are modified. */
export function currentCommit(): string {
  try {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const dirty = execFileSync(
      "git",
      ["status", "--porcelain", "--untracked-files=no", "--", "."],
      {
        encoding: "utf8",
        cwd: path.join(__dirname, "..", ".."),
      },
    ).trim();
    return dirty ? `${sha}-dirty` : sha;
  } catch {
    return "unknown";
  }
}

export function readRecord(network: string): DeploymentRecord | undefined {
  const file = recordPath(network);
  if (!fs.existsSync(file)) return undefined;
  return JSON.parse(fs.readFileSync(file, "utf8")) as DeploymentRecord;
}

export function requireRecord(network: string): DeploymentRecord {
  const record = readRecord(network);
  if (!record?.contracts.ReputationSBT || !record.contracts.RelayEscrow) {
    throw new Error(`No complete deployment for ${network}. Run scripts/deploy.ts first.`);
  }
  return record;
}

export function writeRecord(record: DeploymentRecord): void {
  fs.mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  record.updatedAt = new Date().toISOString();
  fs.writeFileSync(recordPath(record.network), `${JSON.stringify(record, null, 2)}\n`);
}

/** All committed (non-local) deployment records, keyed by network name. */
export function readPublicRecords(): DeploymentRecord[] {
  if (!fs.existsSync(DEPLOYMENTS_DIR)) return [];
  return fs
    .readdirSync(DEPLOYMENTS_DIR)
    .filter((file) => file.endsWith(".json") && !file.endsWith(".local.json"))
    .sort()
    .map((file) => JSON.parse(fs.readFileSync(path.join(DEPLOYMENTS_DIR, file), "utf8")));
}
