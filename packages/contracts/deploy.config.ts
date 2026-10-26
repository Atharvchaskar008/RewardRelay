import type { HardhatRuntimeEnvironment } from "hardhat/types";

/** Template deploy pipeline (create-mst-app). Replaced by the idempotent MST deploy script in H5. */
export async function deployAll(hre: HardhatRuntimeEnvironment) {
  const { ethers } = hre;

  const [deployer] = await ethers.getSigners();

  console.log("Deploying ReputationSBT...");
  console.log("Deployer:", deployer.address);

  // Wei of completed volume per Relay Point (default 0.0001 MSTC = Rs 10 at the demo rate).
  const relayPointUnit = BigInt(process.env.RELAY_POINT_UNIT_WEI || "100000000000000");

  const ReputationSBT = await ethers.getContractFactory("ReputationSBT");
  const sbt = await ReputationSBT.deploy(deployer.address, relayPointUnit);
  await sbt.waitForDeployment();

  const address = await sbt.getAddress();
  console.log("ReputationSBT deployed to:", address);

  return {
    ReputationSBT: {
      address,
      constructorArguments: [deployer.address, relayPointUnit.toString()],
    },
  };
}
