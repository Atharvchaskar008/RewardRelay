import { afterEach, describe, expect, it, vi } from "vitest";
import { MST_MAINNET, MST_TESTNET, deployments } from "@rewardrelay/shared";

const MAINNET_ESCROW = "0x1111111111111111111111111111111111111111";

afterEach(() => {
  vi.unstubAllEnvs();
});

/** The module reads NEXT_PUBLIC_* once at load, as Next inlines them at build time. */
async function loadConfig(env: Record<string, string>) {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  vi.resetModules();
  return import("@/client/config");
}

describe("browser chain config", () => {
  it("defaults to MST Testnet with the recorded escrow", async () => {
    const config = await loadConfig({
      NEXT_PUBLIC_CHAIN_ID: "",
      NEXT_PUBLIC_RPC_URL: "",
      NEXT_PUBLIC_MSTSCAN_URL: "",
      NEXT_PUBLIC_ESCROW_ADDRESS: "",
    });
    expect(config.appConfig.chain).toEqual({
      chainId: MST_TESTNET.id,
      rpcUrl: "/api/rpc/testnet",
      explorerUrl: "https://testnet.mstscan.com",
      escrow: deployments.mstTestnet.contracts.RelayEscrow.address,
    });
    expect(config.isMainnet).toBe(false);
    expect(config.networkName).toBe("MST Testnet");
    expect(config.coinLabel).toBe("test MSTC");
  });

  it("switches to MST Mainnet by env alone", async () => {
    const config = await loadConfig({
      NEXT_PUBLIC_CHAIN_ID: String(MST_MAINNET.id),
      NEXT_PUBLIC_RPC_URL: "",
      NEXT_PUBLIC_MSTSCAN_URL: "",
      NEXT_PUBLIC_ESCROW_ADDRESS: MAINNET_ESCROW,
    });
    expect(config.appConfig.chain).toEqual({
      chainId: MST_MAINNET.id,
      rpcUrl: "/api/rpc/mainnet",
      explorerUrl: "https://mstscan.com",
      escrow: MAINNET_ESCROW,
    });
    expect(config.isMainnet).toBe(true);
    expect(config.networkName).toBe("MST Mainnet");
    expect(config.coinLabel).toBe("MSTC");
  });
});
