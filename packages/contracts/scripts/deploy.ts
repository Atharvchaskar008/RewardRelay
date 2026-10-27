import hre from "hardhat";
import promptSyncFactory from "prompt-sync";
import type { Signer } from "ethers";
import { loadProtocolConfig } from "./lib/config";
import { exportShared } from "./lib/exportShared";
import {
  type DeploymentRecord,
  currentCommit,
  isLocalNetwork,
  readRecord,
  recordPath,
  writeRecord,
} from "./lib/records";
import { GAS_PRICE, explorerUrl, formatMstc, loadCaps, sendTx, spentSoFar } from "./lib/tx";

/**
 * Idempotent, resumable deployment: ReputationSBT, then RelayEscrow(sbt, treasury, server signer,
 * deployer). A contract that is already recorded with code on-chain is skipped; a deployment that
 * was broadcast but not recorded is adopted from its receipt. Finishes by exporting ABIs, addresses
 * and categories to packages/shared.
 *
 *   DRY_RUN=true  estimates both deployments against the network and exits without broadcasting.
 */

async function hasCode(address: string): Promise<boolean> {
  return (await hre.ethers.provider.getCode(address)) !== "0x";
}

async function loadOrCreateRecord(deployer: string, chainId: number): Promise<DeploymentRecord> {
  const network = hre.network.name;
  const existing = readRecord(network);
  if (existing) {
    if (existing.chainId !== chainId) {
      throw new Error(
        `${recordPath(network)} is for chain ${existing.chainId}, connected to ${chainId}.`,
      );
    }
    const addresses = Object.values(existing.contracts).map((contract) => contract.address);
    const alive = await Promise.all(addresses.map(hasCode));
    // A restarted local node has none of the recorded contracts: start a fresh local record.
    if (!(isLocalNetwork(network) && addresses.length > 0 && !alive.some(Boolean))) return existing;
    console.log("Local node was reset: starting a fresh local deployment record.");
  }
  return {
    network,
    chainId,
    deployer,
    commit: currentCommit(),
    updatedAt: new Date().toISOString(),
    contracts: {},
    pending: {},
    transactions: [],
  };
}

async function ensureContract(
  record: DeploymentRecord,
  deployer: Signer,
  name: "ReputationSBT" | "RelayEscrow",
  args: (string | bigint)[],
): Promise<string> {
  const known = record.contracts[name];
  if (known && (await hasCode(known.address))) {
    const recorded = known.constructorArguments.join(",");
    if (recorded !== args.map(String).join(",")) {
      console.warn(
        `  ! ${name} was deployed with other constructor arguments; keeping the deployed one.`,
      );
    }
    console.log(`  = ${name} already deployed at ${known.address}`);
    return known.address;
  }

  const pending = record.pending[name];
  if (pending) {
    const receipt = await hre.ethers.provider.getTransactionReceipt(pending.txHash);
    if (receipt?.status === 1 && receipt.contractAddress) {
      console.log(`  ↺ adopting ${name} from broadcast transaction ${pending.txHash}`);
      record.contracts[name] = {
        address: receipt.contractAddress,
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        constructorArguments: args.map(String),
      };
      delete record.pending[name];
      writeRecord(record);
      return receipt.contractAddress;
    }
    const tx = await hre.ethers.provider.getTransaction(pending.txHash);
    if (tx)
      throw new Error(`${name} deployment ${pending.txHash} is still pending; rerun shortly.`);
    delete record.pending[name];
  }

  const factory = await hre.ethers.getContractFactory(name, deployer);
  const request = await factory.getDeployTransaction(...args);
  const receipt = await sendTx({
    record,
    caps: loadCaps(),
    label: `deploy ${name}`,
    kind: "deploy",
    signer: deployer,
    request,
    onSent: (hash) => {
      record.pending[name] = { txHash: hash };
      writeRecord(record);
    },
  });
  if (!receipt.contractAddress) throw new Error(`${name}: receipt has no contract address`);
  record.contracts[name] = {
    address: receipt.contractAddress,
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    constructorArguments: args.map(String),
  };
  record.commit = currentCommit();
  delete record.pending[name];
  writeRecord(record);
  return receipt.contractAddress;
}

async function dryRun(
  deployer: Signer,
  args: { relayPointUnit: bigint; treasury: string; signer: string },
) {
  const from = await deployer.getAddress();
  const sbtFactory = await hre.ethers.getContractFactory("ReputationSBT", deployer);
  const escrowFactory = await hre.ethers.getContractFactory("RelayEscrow", deployer);
  const sbtTx = await sbtFactory.getDeployTransaction(from, args.relayPointUnit);
  // Any non-zero address passes the escrow constructor checks; the deployer stands in for the badge.
  const escrowTx = await escrowFactory.getDeployTransaction(from, args.treasury, args.signer, from);
  const sbtGas = await deployer.estimateGas({ ...sbtTx, type: 0, gasPrice: GAS_PRICE });
  const escrowGas = await deployer.estimateGas({ ...escrowTx, type: 0, gasPrice: GAS_PRICE });
  const balance = await hre.ethers.provider.getBalance(from);
  console.log(`Estimated ReputationSBT deployment: ${sbtGas} gas`);
  console.log(`Estimated RelayEscrow deployment:   ${escrowGas} gas`);
  console.log(`Estimated cost at 1 gwei: ${formatMstc((sbtGas + escrowGas) * GAS_PRICE)}`);
  console.log(`Deployer balance: ${formatMstc(balance)}`);
}

async function main() {
  const network = hre.network.name;
  const [deployer] = await hre.ethers.getSigners();
  if (!deployer)
    throw new Error("No deployer account. Set DEPLOYER_KEY in packages/contracts/.env.");

  if (network === "mstMainnet") {
    console.log("\n🔴 DEPLOYING TO MAINNET");
    const promptSync = promptSyncFactory({ sigint: true });
    if (promptSync("Type 'yes, deploy to mainnet' to continue: ") !== "yes, deploy to mainnet") {
      throw new Error("Deployment cancelled.");
    }
  }

  const config = loadProtocolConfig();
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);
  console.log(`\nNetwork ${network} (chain ${chainId}), deployer ${deployer.address}`);

  if (process.env.DRY_RUN === "true") {
    await dryRun(deployer, {
      relayPointUnit: config.relayPointUnit,
      treasury: config.treasury,
      signer: config.serverSigner,
    });
    return;
  }

  const record = await loadOrCreateRecord(deployer.address, chainId);
  writeRecord(record);

  const sbt = await ensureContract(record, deployer, "ReputationSBT", [
    deployer.address,
    config.relayPointUnit,
  ]);
  const escrow = await ensureContract(record, deployer, "RelayEscrow", [
    sbt,
    config.treasury,
    config.serverSigner,
    deployer.address,
  ]);

  const files = await exportShared(hre);
  const { spendWei } = spentSoFar(record);
  console.log(`\n✓ ReputationSBT ${explorerUrl(chainId, "address", sbt)}`);
  console.log(`✓ RelayEscrow   ${explorerUrl(chainId, "address", escrow)}`);
  console.log(`Record: ${recordPath(network)}`);
  console.log(
    `Exported: ${files.map((file) => file.split(/[\\/]/).slice(-2).join("/")).join(", ")}`,
  );
  console.log(`Recorded spend on ${network}: ${formatMstc(spendWei)}`);
  if (!isLocalNetwork(network))
    console.log(
      `\nNext: npm run configure:${network === "mstTestnet" ? "testnet" : "mainnet"} -w @rewardrelay/contracts`,
    );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
