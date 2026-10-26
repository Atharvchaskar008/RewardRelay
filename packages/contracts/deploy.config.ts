import type { HardhatRuntimeEnvironment } from "hardhat/types";

export async function deployAll(hre: HardhatRuntimeEnvironment) {
  const { ethers } = await import("hardhat");

  const [deployer] = await ethers.getSigners();

  console.log("Deploying Certificate...");
  console.log("Deployer:", deployer.address);

  const Certificate = await ethers.getContractFactory("Certificate");

  const certificate = await Certificate.deploy();

  await certificate.waitForDeployment();

  const address = await certificate.getAddress();

  console.log("Certificate deployed to:", address);

  return {
    Certificate: {
      address,
      constructorArguments: [],
    },
  };
}
