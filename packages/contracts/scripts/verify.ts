import hre from "hardhat";
import { requireRecord, writeRecord } from "./lib/records";
import { explorerUrl } from "./lib/tx";

/**
 * Verifies every contract of the network's deployment record on mstscan (Blockscout) with the
 * recorded constructor arguments. Already-verified contracts count as success.
 */
async function main() {
  const network = hre.network.name;
  const record = requireRecord(network);
  let failures = 0;

  for (const [name, info] of Object.entries(record.contracts)) {
    console.log(`Verifying ${name} at ${info.address} on ${network}...`);
    try {
      await hre.run("verify:verify", {
        address: info.address,
        constructorArguments: info.constructorArguments,
      });
      console.log(
        `✓ ${name} verified: ${explorerUrl(record.chainId, "address", info.address)}#code`,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes("already verified")) {
        console.log(`✓ ${name} already verified`);
      } else {
        failures++;
        console.error(`✖ Failed to verify ${name}:`, message);
      }
    }
  }

  if (failures === 0) {
    record.verification = { verifiedAt: new Date().toISOString(), explorer: "blockscout" };
    writeRecord(record);
  } else {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
