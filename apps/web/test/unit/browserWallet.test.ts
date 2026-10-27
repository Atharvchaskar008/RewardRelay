import { afterEach, describe, expect, it, vi } from "vitest";
import type { EIP1193Provider } from "viem";
import { MST_TESTNET } from "@rewardrelay/shared";
import { injectedChainContext, publicChain } from "@/client/sdk/chain";
import { clearWalletChoice, loadWalletChoice, saveWalletChoice } from "@/client/walletChoice";

const ADDRESS = "0x1111111111111111111111111111111111111111";
const CONFIG = {
  chainId: MST_TESTNET.id,
  rpcUrl: "/api/rpc/testnet",
  explorerUrl: "https://testnet.mstscan.com",
  escrow: "0x2222222222222222222222222222222222222222" as const,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
    clear: () => items.clear(),
    key: () => null,
    get length() {
      return items.size;
    },
  };
}

describe("remembered wallet choice", () => {
  it("round-trips a browser wallet and forgets it", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    saveWalletChoice({ kind: "injected", rdns: "io.metamask", name: "MetaMask", address: ADDRESS });
    expect(loadWalletChoice()).toEqual({
      kind: "injected",
      rdns: "io.metamask",
      name: "MetaMask",
      address: ADDRESS,
    });
    clearWalletChoice();
    expect(loadWalletChoice()).toBeNull();
  });

  it("ignores corrupt or tampered entries and unavailable storage", () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    storage.setItem("rewardrelay.wallet", "{not json");
    expect(loadWalletChoice()).toBeNull();
    storage.setItem(
      "rewardrelay.wallet",
      JSON.stringify({ kind: "injected", rdns: "x", name: "x", address: "0xnot-an-address" }),
    );
    expect(loadWalletChoice()).toBeNull();

    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    });
    expect(loadWalletChoice()).toBeNull();
    expect(() => saveWalletChoice({ kind: "embedded" })).not.toThrow();
    expect(() => clearWalletChoice()).not.toThrow();
  });
});

describe("browser wallet chain", () => {
  it("gives wallets MST's public RPC, not the app's relative relay path", () => {
    expect(publicChain(CONFIG).rpcUrls.default.http[0]).toBe(MST_TESTNET.rpcUrls.default.http[0]);
    expect(publicChain(CONFIG).rpcUrls.default.http[0]).toMatch(/^https:\/\//);
  });

  it("adds MST to a wallet that does not know it, then switches to it", async () => {
    const calls: { method: string; params?: unknown }[] = [];
    let chainId = 1;
    const provider = {
      request: async ({ method, params }: { method: string; params?: unknown }) => {
        calls.push({ method, params });
        if (method === "eth_chainId") return `0x${chainId.toString(16)}`;
        if (method === "wallet_switchEthereumChain") {
          const target = parseInt((params as [{ chainId: string }])[0].chainId, 16);
          if (!calls.some((call) => call.method === "wallet_addEthereumChain")) {
            throw Object.assign(new Error("Unrecognized chain ID"), { code: 4902 });
          }
          chainId = target;
          return null;
        }
        if (method === "wallet_addEthereumChain") return null; // added, not switched
        throw new Error(`unexpected ${method}`);
      },
    } as unknown as EIP1193Provider;

    const ctx = await injectedChainContext(CONFIG, provider, ADDRESS);
    await ctx.ensureChain?.();
    expect(chainId).toBe(MST_TESTNET.id);
    const added = calls.find((call) => call.method === "wallet_addEthereumChain");
    expect(added?.params).toMatchObject([
      {
        chainId: `0x${MST_TESTNET.id.toString(16)}`,
        rpcUrls: [MST_TESTNET.rpcUrls.default.http[0]],
      },
    ]);

    // Already on the chain: nothing is asked of the wallet.
    calls.length = 0;
    await ctx.ensureChain?.();
    expect(calls.map((call) => call.method)).toEqual(["eth_chainId"]);
  });
});
