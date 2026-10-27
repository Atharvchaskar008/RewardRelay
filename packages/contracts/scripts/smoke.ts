import fs from "fs";
import path from "path";
import hre from "hardhat";
import * as dotenv from "dotenv";
import { ethers, type Signer } from "ethers";
import { CATEGORIES, DealType } from "./lib/config";
import { isLocalNetwork, requireRecord, writeRecord } from "./lib/records";
import { explorerUrl, formatMstc, loadCaps, sendTx, spentSoFar } from "./lib/tx";

/**
 * End-to-end smoke test of a configured deployment with tiny values: the server signer mints two
 * Trust Badges, then a Buy-for-you deal runs list → accept → deliver → confirm. Prints explorer links
 * and asserts the final state (Completed, badges updated, solvencyDelta() == 0).
 *
 * Wallets: the server signer key is read from packages/frontend/.env (VERIFIER_PRIVATE_KEY). On public
 * networks the sharer/seeker keys persist in packages/contracts/.env (SMOKE_SHARER_KEY/SMOKE_SEEKER_KEY,
 * generated on first use, never printed); local runs use throwaway wallets.
 */

const ENV_PATH = path.join(__dirname, "..", ".env");
const FRONTEND_ENV_PATH = path.join(__dirname, "..", "..", "frontend", ".env");

function weiEnv(name: string, fallback: string): bigint {
  const value = process.env[name]?.trim() || fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be an integer amount in wei.`);
  return BigInt(value);
}

/** Price ≤ 0.0002 tMSTC (harness limit for testnet smoke deals). */
const PRICE = weiEnv("SMOKE_PRICE_WEI", ethers.parseEther("0.0002").toString());
const SERVER_TARGET = weiEnv("SMOKE_SERVER_FUND_WEI", ethers.parseEther("0.005").toString());
const PARTY_TARGET = weiEnv("SMOKE_PARTY_FUND_WEI", ethers.parseEther("0.001").toString());

function persistentWallet(name: string, provider: ethers.Provider): ethers.Wallet {
  const existing = process.env[name]?.trim();
  if (existing) return new ethers.Wallet(existing, provider);
  const wallet = ethers.Wallet.createRandom();
  const current = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
  const line = `${name}=${wallet.privateKey}`;
  const pattern = new RegExp(`^${name}=.*$`, "m");
  const updated = pattern.test(current)
    ? current.replace(pattern, () => line)
    : `${current.trimEnd()}\n${line}\n`;
  fs.writeFileSync(ENV_PATH, updated, { mode: 0o600 });
  console.log(`  generated ${name} in packages/contracts/.env (address ${wallet.address})`);
  return new ethers.Wallet(wallet.privateKey, provider);
}

function serverSignerKey(): string {
  const parsed = fs.existsSync(FRONTEND_ENV_PATH)
    ? dotenv.parse(fs.readFileSync(FRONTEND_ENV_PATH))
    : ({} as Record<string, string>);
  const key = process.env.VERIFIER_PRIVATE_KEY?.trim() || parsed.VERIFIER_PRIVATE_KEY?.trim();
  if (!key) throw new Error("VERIFIER_PRIVATE_KEY is not set (packages/frontend/.env).");
  return key;
}

async function main() {
  const network = hre.network.name;
  const record = requireRecord(network);
  const caps = loadCaps();
  const provider = hre.ethers.provider;
  const [deployer] = await hre.ethers.getSigners();

  const server = new ethers.Wallet(serverSignerKey(), provider);
  const local = isLocalNetwork(network);
  const sharer = local
    ? new ethers.Wallet(ethers.Wallet.createRandom().privateKey, provider)
    : persistentWallet("SMOKE_SHARER_KEY", provider);
  const seeker = local
    ? new ethers.Wallet(ethers.Wallet.createRandom().privateKey, provider)
    : persistentWallet("SMOKE_SEEKER_KEY", provider);

  const sbt = await hre.ethers.getContractAt(
    "ReputationSBT",
    record.contracts.ReputationSBT.address,
  );
  const escrow = await hre.ethers.getContractAt(
    "RelayEscrow",
    record.contracts.RelayEscrow.address,
  );
  const send = (
    label: string,
    signer: Signer,
    request: ethers.TransactionRequest,
    kind: "smoke" | "transfer" = "smoke",
  ) => sendTx({ record, caps, label, kind, signer, request });

  console.log(`\nSmoke test on ${network}`);
  console.log(
    `  server signer ${server.address}\n  sharer ${sharer.address}\n  seeker ${seeker.address}`,
  );
  if (!(await sbt.hasRole(await sbt.VERIFIER_ROLE(), server.address))) {
    throw new Error(
      "The server signer has no VERIFIER_ROLE on the badge. Run scripts/configure.ts first.",
    );
  }

  // 1. Fund our own wallets up to their targets (counted against the transfer cap).
  for (const [label, wallet, target] of [
    ["server signer", server, SERVER_TARGET],
    ["sharer", sharer, PARTY_TARGET],
    ["seeker", seeker, PARTY_TARGET],
  ] as const) {
    const balance = await provider.getBalance(wallet.address);
    if (balance >= target / 2n) continue;
    await send(
      `fund ${label}`,
      deployer,
      { to: wallet.address, value: target - balance },
      "transfer",
    );
  }

  // 2. Trust Badges, minted by the server signer exactly like /api/auth/link-wallet will.
  for (const [label, wallet] of [
    ["sharer", sharer],
    ["seeker", seeker],
  ] as const) {
    if (await sbt.hasBadge(wallet.address)) continue;
    await send(
      `mint badge for ${label}`,
      server,
      await sbt.mint.populateTransaction(wallet.address),
    );
  }

  // 3. Buy-for-you deal: list → accept → deliver → confirm.
  const category = CATEGORIES.find((entry) => entry.dealType === DealType.BuyForYou);
  if (!category) throw new Error("No Buy-for-you category configured.");
  const terms = JSON.stringify({
    title: "Smoke test deal",
    category: category.key,
    priceWei: PRICE.toString(),
  });
  const termsHash = ethers.keccak256(ethers.toUtf8Bytes(terms));
  const sharerDeposit = await escrow.requiredSharerDeposit(sharer.address, PRICE);
  const before = {
    sharer: await sbt.statsOf(sharer.address),
    seeker: await sbt.statsOf(seeker.address),
    treasury: await provider.getBalance(await escrow.treasury()),
  };

  const listReceipt = await send(
    "createListing (Buy-for-you)",
    sharer,
    await escrow.createListing.populateTransaction(
      category.id,
      PRICE,
      0,
      termsHash,
      ethers.ZeroHash,
      {
        nonce: 0,
        deadline: 0,
        signature: "0x",
      },
      { value: sharerDeposit },
    ),
  );
  const created = listReceipt.logs
    .map((log) => {
      try {
        return escrow.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((parsed) => parsed?.name === "ListingCreated");
  if (!created) throw new Error("ListingCreated event not found");
  const id = created.args.id as bigint;

  const listed = await escrow.getDeal(id);
  await send(
    "acceptListing",
    seeker,
    await escrow.acceptListing.populateTransaction(id, {
      value: listed.price + listed.seekerDeposit,
    }),
  );
  const salt = ethers.hexlify(ethers.randomBytes(32));
  const proofHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "string", "bytes32"],
      [id, `SMOKE-${id}`, salt],
    ),
  );
  await send(
    "markDelivered",
    sharer,
    await escrow.markDelivered.populateTransaction(id, proofHash),
  );
  await send("confirmReceipt", seeker, await escrow.confirmReceipt.populateTransaction(id));

  // 4. Assertions.
  const deal = await escrow.getDeal(id);
  const after = {
    sharer: await sbt.statsOf(sharer.address),
    seeker: await sbt.statsOf(seeker.address),
    treasury: await provider.getBalance(await escrow.treasury()),
  };
  const fee = (PRICE * deal.feeBps) / 10_000n;
  const checks: [string, boolean][] = [
    ["deal status is Completed (3)", Number(deal.status) === 3],
    ["proof hash stored on-chain", deal.proofHash === proofHash],
    ["sharer completed +1", after.sharer.completed === before.sharer.completed + 1n],
    ["seeker completed +1", after.seeker.completed === before.seeker.completed + 1n],
    [`treasury received the ${deal.feeBps} bps fee`, after.treasury - before.treasury === fee],
    ["solvencyDelta() == 0", (await escrow.solvencyDelta()) === 0n],
  ];
  for (const [label, ok] of checks) console.log(`  ${ok ? "✓" : "✗"} ${label}`);
  if (checks.some(([, ok]) => !ok)) throw new Error("Smoke assertions failed");

  record.smoke = {
    ranAt: new Date().toISOString(),
    dealId: id.toString(),
    category: category.key,
    priceWei: PRICE.toString(),
    sharer: sharer.address,
    seeker: seeker.address,
    feeWei: fee.toString(),
    transactions: record.transactions
      .filter((tx) => tx.kind !== "deploy" && tx.kind !== "config")
      .map((tx) => tx.hash),
  };
  writeRecord(record);

  console.log(
    `\nDeal #${id}: ${explorerUrl(record.chainId, "address", await escrow.getAddress())}`,
  );
  console.log(
    `Recorded spend on ${network}: ${formatMstc(spentSoFar(record).spendWei)} (transfers ${formatMstc(spentSoFar(record).transferWei)})`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
