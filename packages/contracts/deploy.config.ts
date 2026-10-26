import type { HardhatRuntimeEnvironment } from "hardhat/types";

/** Template deploy pipeline (create-mst-app). Replaced by the idempotent MST deploy script in H5. */
export async function deployAll(hre: HardhatRuntimeEnvironment) {
  const { ethers } = hre;

  const [deployer] = await ethers.getSigners();

  console.log("Deploying ReputationSBT...");
  console.log("Deployer:", deployer.address);

  const ReputationSBT = await ethers.getContractFactory("ReputationSBT");
  const sbt = await ReputationSBT.deploy(deployer.address);
  await sbt.waitForDeployment();

  const address = await sbt.getAddress();
  console.log("ReputationSBT deployed to:", address);

  return {
    ReputationSBT: {
      address,
      constructorArguments: [deployer.address],
    },
  };
}
