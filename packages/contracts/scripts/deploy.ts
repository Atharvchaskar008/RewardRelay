import hre from "hardhat";
import promptSyncFactory from "prompt-sync";
import type { Signer, TransactionRequest } from "ethers";
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
 *   DRY_RUN=true  (`npm run preflight:<network>`) prints the deployer, nonce, balance, gas estimate,
 *                 predicted addresses and the planned configuration, and exits without broadcasting.
 * On mainnet a real run refuses a used deployer (its addresses would differ from testnet's) unless
 * ALLOW_NEW_ADDRESSES=true, refuses a balance below the deploy and configure estimate, and asks for a
 * typed confirmation.
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

/** Gas for configure.ts on a fresh deployment (measured on testnet: about 0.7 M), with margin. */
const CONFIGURE_GAS_ALLOWANCE = 1_000_000n;
/**
 * Deployment gas measured on MST Testnet (same bytecode and EVM), used when a node refuses to
 * estimate for an unfunded deployer (MST mainnet answers "insufficient funds for transfer").
 */
const MEASURED_GAS = { sbt: 2_495_660n, escrow: 4_284_912n };

async function estimateOr(deployer: Signer, tx: TransactionRequest, measured: bigint) {
  try {
    return { gas: await deployer.estimateGas({ ...tx, type: 0 }), measured: false };
  } catch {
    return { gas: measured, measured: true };
  }
}

async function estimateDeployment(
  deployer: Signer,
  args: { relayPointUnit: bigint; treasury: string; signer: string },
) {
  const from = await deployer.getAddress();
  const sbtFactory = await hre.ethers.getContractFactory("ReputationSBT", deployer);
  const escrowFactory = await hre.ethers.getContractFactory("RelayEscrow", deployer);
  const sbtTx = await sbtFactory.getDeployTransaction(from, args.relayPointUnit);
  // Any non-zero address passes the escrow constructor checks; the deployer stands in for the badge.
  const escrowTx = await escrowFactory.getDeployTransaction(from, args.treasury, args.signer, from);
  const sbt = await estimateOr(deployer, sbtTx, MEASURED_GAS.sbt);
  const escrow = await estimateOr(deployer, escrowTx, MEASURED_GAS.escrow);
  const sbtGas = sbt.gas;
  const escrowGas = escrow.gas;
  const balance = await hre.ethers.provider.getBalance(from);
  const nonce = await hre.ethers.provider.getTransactionCount(from);
  const needed = (sbtGas + escrowGas + CONFIGURE_GAS_ALLOWANCE) * GAS_PRICE;
  const measured = sbt.measured || escrow.measured;
  return { from, sbtGas, escrowGas, measured, balance, nonce, needed };
}

async function dryRun(deployer: Signer, config: ReturnType<typeof loadProtocolConfig>) {
  const estimate = await estimateDeployment(deployer, {
    relayPointUnit: config.relayPointUnit,
    treasury: config.treasury,
    signer: config.serverSigner,
  });
  const predicted = [0, 1].map((offset) =>
    hre.ethers.getCreateAddress({ from: estimate.from, nonce: estimate.nonce + offset }),
  );
  const testnet = readRecord("mstTestnet");
  const sameAsTestnet =
    testnet?.deployer.toLowerCase() === estimate.from.toLowerCase() &&
    predicted[0] === testnet.contracts.ReputationSBT?.address &&
    predicted[1] === testnet.contracts.RelayEscrow?.address;
  const deployGas = estimate.sbtGas + estimate.escrowGas;

  console.log("\nPreflight (nothing is sent)");
  console.log(`  Deployer          ${estimate.from} (nonce ${estimate.nonce})`);
  console.log(`  Balance           ${formatMstc(estimate.balance)}`);
  console.log(
    `  Deployment gas    ReputationSBT ${estimate.sbtGas}, RelayEscrow ${estimate.escrowGas}${estimate.measured ? " (measured on testnet: this node will not estimate for an unfunded deployer)" : ""}`,
  );
  console.log(
    `  Cost at 1 gwei    ${formatMstc(deployGas * GAS_PRICE)} to deploy, ${formatMstc(estimate.needed)} with configure`,
  );
  console.log(`  Enough balance    ${estimate.balance >= estimate.needed ? "yes" : "NO"}`);
  console.log(`  ReputationSBT at  ${predicted[0]}`);
  console.log(`  RelayEscrow at    ${predicted[1]}`);
  console.log(`  Same as testnet   ${sameAsTestnet ? "yes" : "no"}`);
  console.log("\nPlanned configuration (configure.ts)");
  console.log(`  Policy profile    ${config.policyProfile}`);
  console.log(`  Tier limits       ${config.tierLimits.map(formatMstc).join(" / ")}`);
  console.log(
    `  Sharer deposits   ${config.sharerDepositBps.join(" / ")} bps (New / Trusted / Verified)`,
  );
  console.log(`  Seeker deposit    ${config.seekerDepositBps} bps`);
  console.log(`  Fee               ${config.feeBps} bps`);
  console.log(`  Arbiter timeout   ${config.arbiterTimeout} s`);
  console.log(`  Treasury          ${config.treasury}`);
  console.log(`  Server signer     ${config.serverSigner}`);
}

async function main() {
  const network = hre.network.name;
  const [deployer] = await hre.ethers.getSigners();
  if (!deployer)
    throw new Error("No deployer account. Set DEPLOYER_KEY in packages/contracts/.env.");

  const config = loadProtocolConfig();
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);
  console.log(`\nNetwork ${network} (chain ${chainId}), deployer ${deployer.address}`);

  if (process.env.DRY_RUN === "true") {
    await dryRun(deployer, config);
    return;
  }

  if (network === "mstMainnet") {
    const estimate = await estimateDeployment(deployer, {
      relayPointUnit: config.relayPointUnit,
      treasury: config.treasury,
      signer: config.serverSigner,
    });
    if (
      !readRecord(network) &&
      estimate.nonce !== 0 &&
      process.env.ALLOW_NEW_ADDRESSES !== "true"
    ) {
      throw new Error(
        `The deployer has already sent ${estimate.nonce} mainnet transaction(s), so the contracts would not get the testnet addresses. Set ALLOW_NEW_ADDRESSES=true to deploy anyway.`,
      );
    }
    if (estimate.balance < estimate.needed) {
      throw new Error(
        `The deployer holds ${formatMstc(estimate.balance)}; deploy and configure need about ${formatMstc(estimate.needed)}.`,
      );
    }
    console.log("\n🔴 DEPLOYING TO MAINNET");
    const promptSync = promptSyncFactory({ sigint: true });
    if (promptSync("Type 'yes, deploy to mainnet' to continue: ") !== "yes, deploy to mainnet") {
      throw new Error("Deployment cancelled.");
    }
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
