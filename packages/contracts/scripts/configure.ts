import hre from "hardhat";
import type { TransactionRequest } from "ethers";
import { CATEGORIES, loadProtocolConfig } from "./lib/config";
import { requireRecord, writeRecord } from "./lib/records";
import { explorerUrl, formatMstc, loadCaps, sendTx, spentSoFar } from "./lib/tx";

/**
 * Idempotent configuration of a recorded deployment. Every step reads the current on-chain value
 * first and only sends a transaction when it differs; after sending, it reads the value back and
 * fails loudly on a mismatch. Safe to rerun at any time.
 *
 * - SBT: ESCROW_ROLE → escrow; VERIFIER_ROLE → server signer; tier limits.
 * - Escrow: VERIFIER_ROLE + ARBITER_ROLE → server signer; one policy per category (demo windows);
 *   deposit bps, fee, arbiter timeout, treasury.
 */

async function main() {
  const network = hre.network.name;
  const record = requireRecord(network);
  const config = loadProtocolConfig();
  const caps = loadCaps();
  const [admin] = await hre.ethers.getSigners();

  const sbt = await hre.ethers.getContractAt(
    "ReputationSBT",
    record.contracts.ReputationSBT.address,
    admin,
  );
  const escrow = await hre.ethers.getContractAt(
    "RelayEscrow",
    record.contracts.RelayEscrow.address,
    admin,
  );
  const escrowAddress = await escrow.getAddress();
  console.log(`\nConfiguring ${network}: escrow ${escrowAddress}, badge ${await sbt.getAddress()}`);

  async function step(
    label: string,
    isDone: () => Promise<boolean>,
    populate: () => Promise<TransactionRequest>,
  ): Promise<void> {
    if (await isDone()) {
      console.log(`  = ${label}`);
      return;
    }
    await sendTx({ record, caps, label, kind: "config", signer: admin, request: await populate() });
    if (!(await isDone()))
      throw new Error(`${label}: on-chain value does not match after the transaction`);
  }

  const [escrowRole, sbtVerifierRole, escrowVerifierRole, arbiterRole] = await Promise.all([
    sbt.ESCROW_ROLE(),
    sbt.VERIFIER_ROLE(),
    escrow.VERIFIER_ROLE(),
    escrow.ARBITER_ROLE(),
  ]);

  await step(
    "badge: ESCROW_ROLE → escrow",
    () => sbt.hasRole(escrowRole, escrowAddress),
    () => sbt.grantRole.populateTransaction(escrowRole, escrowAddress),
  );
  await step(
    "badge: VERIFIER_ROLE → server signer",
    () => sbt.hasRole(sbtVerifierRole, config.serverSigner),
    () => sbt.grantRole.populateTransaction(sbtVerifierRole, config.serverSigner),
  );
  await step(
    "escrow: VERIFIER_ROLE → server signer",
    () => escrow.hasRole(escrowVerifierRole, config.serverSigner),
    () => escrow.grantRole.populateTransaction(escrowVerifierRole, config.serverSigner),
  );
  await step(
    "escrow: ARBITER_ROLE → server signer",
    () => escrow.hasRole(arbiterRole, config.serverSigner),
    () => escrow.grantRole.populateTransaction(arbiterRole, config.serverSigner),
  );

  for (const category of CATEGORIES) {
    const wanted = { dealType: category.dealType, ...category.demo, active: true };
    await step(
      `escrow: policy ${category.id} ${category.key}`,
      async () => {
        const policy = await escrow.getPolicy(category.id);
        return (
          Number(policy.dealType) === wanted.dealType &&
          Number(policy.deliveryWindow) === wanted.deliveryWindow &&
          Number(policy.releaseDelay) === wanted.releaseDelay &&
          Number(policy.eventBuffer) === wanted.eventBuffer &&
          Number(policy.disputeWindow) === wanted.disputeWindow &&
          policy.active
        );
      },
      () => escrow.setPolicy.populateTransaction(category.id, wanted),
    );
  }

  await step(
    "badge: tier limits",
    async () => {
      const limits = await Promise.all([0, 1, 2].map((tier) => sbt.tierLimit(tier)));
      return limits.every((limit, tier) => limit === config.tierLimits[tier]);
    },
    () => sbt.setTierLimits.populateTransaction(config.tierLimits),
  );
  await step(
    "escrow: deposit bps",
    async () => {
      const sharer = await Promise.all([0, 1, 2].map((tier) => escrow.sharerDepositBps(tier)));
      return (
        sharer.every((bps, tier) => Number(bps) === config.sharerDepositBps[tier]) &&
        Number(await escrow.seekerDepositBps()) === config.seekerDepositBps
      );
    },
    () =>
      escrow.setDepositBps.populateTransaction(config.sharerDepositBps, config.seekerDepositBps),
  );
  await step(
    "escrow: fee bps",
    async () => Number(await escrow.feeBps()) === config.feeBps,
    () => escrow.setFeeBps.populateTransaction(config.feeBps),
  );
  await step(
    "escrow: arbiter timeout",
    async () => Number(await escrow.arbiterTimeout()) === config.arbiterTimeout,
    () => escrow.setArbiterTimeout.populateTransaction(config.arbiterTimeout),
  );
  await step(
    "escrow: treasury",
    async () => (await escrow.treasury()).toLowerCase() === config.treasury.toLowerCase(),
    () => escrow.setTreasury.populateTransaction(config.treasury),
  );

  // Read everything back from the chain and keep the snapshot in the deployment record.
  const policies = await Promise.all(
    CATEGORIES.map(async (category) => {
      const policy = await escrow.getPolicy(category.id);
      return {
        id: category.id,
        key: category.key,
        dealType: Number(policy.dealType) === 0 ? "BuyForYou" : "PassOn",
        deliveryWindow: Number(policy.deliveryWindow),
        releaseDelay: Number(policy.releaseDelay),
        eventBuffer: Number(policy.eventBuffer),
        disputeWindow: Number(policy.disputeWindow),
        active: policy.active,
      };
    }),
  );
  const snapshot = {
    readAt: new Date().toISOString(),
    serverSigner: config.serverSigner,
    roles: {
      badgeEscrowRole: await sbt.hasRole(escrowRole, escrowAddress),
      badgeVerifierRole: await sbt.hasRole(sbtVerifierRole, config.serverSigner),
      escrowVerifierRole: await escrow.hasRole(escrowVerifierRole, config.serverSigner),
      escrowArbiterRole: await escrow.hasRole(arbiterRole, config.serverSigner),
    },
    tierLimitsWei: (await Promise.all([0, 1, 2].map((tier) => sbt.tierLimit(tier)))).map(String),
    sharerDepositBps: (
      await Promise.all([0, 1, 2].map((tier) => escrow.sharerDepositBps(tier)))
    ).map(Number),
    seekerDepositBps: Number(await escrow.seekerDepositBps()),
    feeBps: Number(await escrow.feeBps()),
    arbiterTimeout: Number(await escrow.arbiterTimeout()),
    treasury: await escrow.treasury(),
    policies,
  };
  record.configuration = snapshot;
  writeRecord(record);

  console.log("\nRead back from chain:");
  console.log(`  roles ${JSON.stringify(snapshot.roles)}`);
  console.log(
    `  tier limits ${snapshot.tierLimitsWei.map((wei) => formatMstc(BigInt(wei))).join(" / ")}`,
  );
  console.log(
    `  deposits sharer ${snapshot.sharerDepositBps.join("/")} bps, seeker ${snapshot.seekerDepositBps} bps`,
  );
  console.log(`  fee ${snapshot.feeBps} bps, arbiter timeout ${snapshot.arbiterTimeout} s`);
  console.log(`  treasury ${explorerUrl(record.chainId, "address", snapshot.treasury)}`);
  for (const policy of policies) {
    console.log(
      `  policy ${policy.id} ${policy.key.padEnd(10)} ${policy.dealType.padEnd(9)} deliver ${policy.deliveryWindow}s ` +
        `release ${policy.releaseDelay}s buffer ${policy.eventBuffer}s evidence ${policy.disputeWindow}s`,
    );
  }
  console.log(`Recorded spend on ${network}: ${formatMstc(spentSoFar(record).spendWei)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
