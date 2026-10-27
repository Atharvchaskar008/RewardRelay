import { spawn, spawnSync, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { hardhat } from "viem/chains";
import type { TestProject } from "vitest/node";
import { CATEGORIES, relayEscrowAbi, reputationSbtAbi } from "rewardrelay-shared";

/**
 * Integration-suite global setup: starts a local Hardhat node (Shanghai rules, like MST), deploys
 * ReputationSBT + RelayEscrow and configures them the way scripts/configure.ts does, with throwaway
 * server keys. Tests read the result with `inject("chain")`. Firebase emulators are started by
 * `firebase emulators:exec` around the whole run (npm run test:emulators -w frontend).
 */

export interface ChainFixture {
  rpcUrl: string;
  chainId: number;
  escrow: Address;
  sbt: Address;
  verifierKey: Hex;
  funderKey: Hex;
  releaserKey: Hex;
  /** Hardhat account #0: admin of both contracts, also used to fund test wallets. */
  adminKey: Hex;
  treasury: Address;
}

declare module "vitest" {
  export interface ProvidedContext {
    chain: ChainFixture;
  }
}

const PORT = Number(process.env.INTEGRATION_RPC_PORT ?? 8547);
const RPC_URL = `http://127.0.0.1:${PORT}`;
/** Hardhat's well-known development accounts #0 and #9 (public test keys, no value anywhere). */
const ADMIN_KEY: Hex = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const TREASURY: Address = "0xa0Ee7A142d267C1f36714E4a8F75612F20a79720";
const CONTRACTS_DIR = path.resolve(__dirname, "../../../contracts");
const HARDHAT_CLI = path.resolve(__dirname, "../../../../node_modules/hardhat/internal/cli/cli.js");

let node: ChildProcess | undefined;

function artifact(name: string): { abi: Abi; bytecode: Hex } {
  const file = path.join(CONTRACTS_DIR, "artifacts", "contracts", `${name}.sol`, `${name}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`Missing ${name} artifact: run "npm run compile -w contracts" first.`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

async function waitForRpc(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(RPC_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Hardhat node did not start on ${RPC_URL}`);
}

export async function setup(project: TestProject): Promise<void> {
  node = spawn(
    process.execPath,
    [HARDHAT_CLI, "node", "--hostname", "127.0.0.1", "--port", String(PORT)],
    {
      cwd: CONTRACTS_DIR,
      stdio: "ignore",
    },
  );
  await waitForRpc();

  const chain = { ...hardhat, rpcUrls: { default: { http: [RPC_URL] } } };
  const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
  const admin = createWalletClient({
    account: privateKeyToAccount(ADMIN_KEY),
    chain,
    transport: http(RPC_URL),
  });
  const tx = async (hash: Hex) => {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`setup transaction ${hash} failed`);
    return receipt;
  };

  const verifierKey = generatePrivateKey();
  const funderKey = generatePrivateKey();
  const releaserKey = generatePrivateKey();
  const verifier = privateKeyToAccount(verifierKey).address;
  for (const key of [verifierKey, funderKey, releaserKey]) {
    await tx(
      await admin.sendTransaction({
        to: privateKeyToAccount(key).address,
        value: parseEther("100"),
      }),
    );
  }

  const sbtArtifact = artifact("ReputationSBT");
  const sbtReceipt = await tx(
    await admin.deployContract({
      abi: sbtArtifact.abi,
      bytecode: sbtArtifact.bytecode,
      args: [admin.account.address, 10n ** 14n],
    }),
  );
  const sbt = sbtReceipt.contractAddress as Address;
  const escrowArtifact = artifact("RelayEscrow");
  const escrowReceipt = await tx(
    await admin.deployContract({
      abi: escrowArtifact.abi,
      bytecode: escrowArtifact.bytecode,
      args: [sbt, TREASURY, verifier, admin.account.address],
    }),
  );
  const escrow = escrowReceipt.contractAddress as Address;

  const write = (address: Address, abi: Abi, functionName: string, args: unknown[]) =>
    admin.writeContract({ address, abi, functionName, args } as never).then(tx);

  const roles = {
    escrowRole: await publicClient.readContract({
      address: sbt,
      abi: reputationSbtAbi,
      functionName: "ESCROW_ROLE",
    }),
    sbtVerifier: await publicClient.readContract({
      address: sbt,
      abi: reputationSbtAbi,
      functionName: "VERIFIER_ROLE",
    }),
    arbiter: await publicClient.readContract({
      address: escrow,
      abi: relayEscrowAbi,
      functionName: "ARBITER_ROLE",
    }),
  };
  await write(sbt, reputationSbtAbi, "grantRole", [roles.escrowRole, escrow]);
  await write(sbt, reputationSbtAbi, "grantRole", [roles.sbtVerifier, verifier]);
  await write(escrow, relayEscrowAbi, "grantRole", [roles.arbiter, verifier]);
  for (const category of CATEGORIES) {
    await write(escrow, relayEscrowAbi, "setPolicy", [
      category.id,
      {
        dealType: category.dealType === "BuyForYou" ? 0 : 1,
        ...category.demo,
        active: true,
      },
    ]);
  }
  await write(sbt, reputationSbtAbi, "setTierLimits", [
    [parseEther("0.005"), parseEther("0.02"), parseEther("0.1")],
  ]);

  project.provide("chain", {
    rpcUrl: RPC_URL,
    chainId: 31337,
    escrow,
    sbt,
    verifierKey,
    funderKey,
    releaserKey,
    adminKey: ADMIN_KEY,
    treasury: TREASURY,
  });
}

export async function teardown(): Promise<void> {
  if (!node?.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(node.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    node.kill("SIGTERM");
  }
}
