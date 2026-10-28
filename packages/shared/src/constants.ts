/**
 * Chain configuration in the shape viem's `defineChain` expects (no viem dependency here), plus the
 * local Hardhat chain used by development and the integration tests.
 */

export interface ChainConfig {
  id: number;
  name: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrls: { default: { http: readonly string[] } };
  blockExplorers?: { default: { name: string; url: string; apiUrl?: string } };
  testnet: boolean;
}

export const MST_TESTNET = {
  id: 91562037,
  name: "MST Testnet",
  nativeCurrency: { name: "MST Coin", symbol: "MSTC", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnetrpc.mstblockchain.com"] } },
  blockExplorers: {
    default: {
      name: "MSTScan",
      url: "https://testnet.mstscan.com",
      apiUrl: "https://testnet.mstscan.com/api",
    },
  },
  testnet: true,
} as const satisfies ChainConfig;

export const MST_MAINNET = {
  id: 4646,
  name: "MST Mainnet",
  nativeCurrency: { name: "MST Coin", symbol: "MSTC", decimals: 18 },
  rpcUrls: { default: { http: ["https://mariorpc.mstblockchain.com"] } },
  blockExplorers: {
    default: { name: "MSTScan", url: "https://mstscan.com", apiUrl: "https://mstscan.com/api" },
  },
  testnet: false,
} as const satisfies ChainConfig;

export const LOCAL_CHAIN = {
  id: 31337,
  name: "Hardhat",
  nativeCurrency: { name: "MST Coin", symbol: "MSTC", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
  testnet: true,
} as const satisfies ChainConfig;

export const CHAINS = [MST_TESTNET, MST_MAINNET, LOCAL_CHAIN] as const;

export function chainById(id: number): ChainConfig | undefined {
  return CHAINS.find((chain) => chain.id === id);
}

/** MST has no base fee: every transaction is legacy (type 0) at 1 gwei. */
export const GAS_PRICE_WEI = 1_000_000_000n;

/** Path segment of the app's same-origin JSON-RPC relay (`/api/rpc/<network>`) per chain. */
export const RPC_RELAY_NETWORKS: Record<string, number> = {
  testnet: MST_TESTNET.id,
  mainnet: MST_MAINNET.id,
  local: LOCAL_CHAIN.id,
};

/** The relay path for a chain id, e.g. `/api/rpc/testnet`, or undefined for an unknown chain. */
export function rpcRelayPath(chainId: number): string | undefined {
  const entry = Object.entries(RPC_RELAY_NETWORKS).find(([, id]) => id === chainId);
  return entry ? `/api/rpc/${entry[0]}` : undefined;
}
