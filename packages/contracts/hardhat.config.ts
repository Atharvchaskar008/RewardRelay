import "@nomicfoundation/hardhat-toolbox";
import type { HardhatUserConfig } from "hardhat/config";
import * as dotenv from "dotenv";

// Secrets live in packages/contracts/.env (never committed). See .env.example.
dotenv.config();

/** MST charges no base fee, so every transaction is a legacy transaction at a fixed 1 gwei. */
const GAS_PRICE_WEI = 1_000_000_000;

const deployerKey = process.env.DEPLOYER_KEY;
const accounts = deployerKey ? [deployerKey] : [];

const MST_TESTNET = {
  chainId: 91562037,
  rpcUrl: process.env.MST_TESTNET_RPC_URL || "https://testnetrpc.mstblockchain.com",
  explorerUrl: "https://testnet.mstscan.com",
};

const MST_MAINNET = {
  chainId: 4646,
  rpcUrl: process.env.MST_MAINNET_RPC_URL || "https://mariorpc.mstblockchain.com",
  explorerUrl: "https://mstscan.com",
};

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // MST mainnet has no Cancun opcodes (TSTORE/TLOAD, MCOPY, BLOBHASH).
      evmVersion: "shanghai",
    },
  },
  networks: {
    // The local network mirrors MST: Shanghai rules, zero base fee, 1 gwei legacy gas price.
    hardhat: {
      chainId: 31337,
      hardfork: "shanghai",
      initialBaseFeePerGas: 0,
      gasPrice: GAS_PRICE_WEI,
    },
    mstTestnet: {
      url: MST_TESTNET.rpcUrl,
      chainId: MST_TESTNET.chainId,
      accounts,
      gasPrice: GAS_PRICE_WEI,
    },
    mstMainnet: {
      url: MST_MAINNET.rpcUrl,
      chainId: MST_MAINNET.chainId,
      accounts,
      gasPrice: GAS_PRICE_WEI,
    },
  },
  // mstscan is a Blockscout instance: any non-empty API key is accepted.
  etherscan: {
    apiKey: {
      mstTestnet: process.env.MSTSCAN_API_KEY || "blockscout",
      mstMainnet: process.env.MSTSCAN_API_KEY || "blockscout",
    },
    customChains: [
      {
        network: "mstTestnet",
        chainId: MST_TESTNET.chainId,
        urls: {
          apiURL: `${MST_TESTNET.explorerUrl}/api`,
          browserURL: MST_TESTNET.explorerUrl,
        },
      },
      {
        network: "mstMainnet",
        chainId: MST_MAINNET.chainId,
        urls: {
          apiURL: `${MST_MAINNET.explorerUrl}/api`,
          browserURL: MST_MAINNET.explorerUrl,
        },
      },
    ],
  },
  sourcify: { enabled: false },
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
    gasPrice: 1,
    noColors: true,
  },
  mocha: { timeout: 120_000 },
};

export default config;
