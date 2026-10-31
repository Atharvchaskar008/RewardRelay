import { afterEach, describe, expect, it, vi } from "vitest";
import type { EIP1193Provider } from "viem";
import { MST_MAINNET } from "@rewardrelay/shared";
import { ChainError, payForDeal, type SdkContext } from "@/client/sdk";
import { injectedChainContext, markDelivered, type ChainContext } from "@/client/sdk/chain";
import { loadSavedDelivery, saveDelivery } from "@/client/savedDelivery";

const HASH = `0x${"ab".repeat(32)}` as const;
const PROOF = `0x${"cd".repeat(32)}` as const;
const ADDRESS = "0x1111111111111111111111111111111111111111";
const CONFIG = {
  chainId: MST_MAINNET.id,
  rpcUrl: "/api/rpc/mainnet",
  explorerUrl: "https://mstscan.com",
  escrow: "0x2222222222222222222222222222222222222222" as const,
};
const DETAILS = {
  name: "Asha Rao",
  phone: "9876543210",
  addressLines: ["12 MG Road"],
  pincode: "560001",
};

function fakeChain(getTransactionReceipt: () => Promise<unknown>) {
  const writeContract = vi.fn(async () => HASH);
  const ctx = {
    config: CONFIG,
    chain: {},
    account: ADDRESS,
    publicClient: {
      simulateContract: async () => ({}),
      readContract: async () => ({ price: 10n, seekerDeposit: 1n }),
      getTransactionReceipt,
    },
    walletClient: { writeContract },
  } as unknown as ChainContext;
  return { ctx, writeContract };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("after the wallet returned a hash", () => {
  it("keeps polling through relay failures until the receipt arrives", async () => {
    const getReceipt = vi
      .fn()
      .mockRejectedValueOnce(new Error("HTTP request failed. Status: 500"))
      .mockRejectedValueOnce(new Error("The request took too long to respond."))
      .mockResolvedValueOnce({ status: "success", logs: [] });
    const { ctx } = fakeChain(getReceipt);

    await expect(markDelivered(ctx, 4n, PROOF)).resolves.toMatchObject({ hash: HASH });
    expect(getReceipt).toHaveBeenCalledTimes(3);
  });

  it("still reports a transaction the chain reverted", async () => {
    const { ctx } = fakeChain(async () => ({ status: "reverted", logs: [] }));
    await expect(markDelivered(ctx, 4n, PROOF)).rejects.toMatchObject({
      reason: "Reverted",
      hash: HASH,
    });
  });
});

describe("a wallet on the wrong network", () => {
  it("is told so, and nothing is sent", async () => {
    const provider = {
      request: async ({ method }: { method: string }) => {
        if (method === "eth_chainId") return "0x1";
        throw Object.assign(new Error("Method not supported"), { code: -32601 });
      },
    } as unknown as EIP1193Provider;
    const ctx = await injectedChainContext(CONFIG, provider, ADDRESS);
    const writeContract = vi.fn();
    const simulated = {
      ...ctx,
      publicClient: { simulateContract: async () => ({}) },
      walletClient: { ...ctx.walletClient, writeContract },
    } as unknown as ChainContext;

    const error = await markDelivered(simulated, 4n, PROOF).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ChainError);
    expect(error).toMatchObject({ reason: "WrongChain" });
    expect((error as Error).message).toContain("MST Mainnet");
    expect(writeContract).not.toHaveBeenCalled();
  });
});

describe("payForDeal", () => {
  it("does not report a mined payment as failed when the address upload fails", async () => {
    const { ctx } = fakeChain(async () => ({ status: "success", logs: [] }));
    const submitDetails = vi.fn(async () => {
      throw new Error("offline");
    });
    const sdk = {
      chain: ctx,
      inrPerMstc: 100_000,
      api: {
        deals: {
          get: async () => ({ id: "4", type: "BuyForYou", status: "Locked" }),
          submitDetails,
        },
      },
    } as unknown as SdkContext;

    await expect(payForDeal(sdk, "4", DETAILS)).resolves.toMatchObject({
      tx: { hash: HASH },
      deal: { status: "Locked" },
    });
    expect(submitDetails).toHaveBeenCalledOnce();
  });
});

describe("saved delivery address", () => {
  function memoryStorage() {
    const items = new Map<string, string>();
    return {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
    };
  }

  it("round-trips a complete address, per account", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    saveDelivery(DETAILS, "uid-a");
    expect(loadSavedDelivery("uid-a")).toEqual(DETAILS);
    expect(loadSavedDelivery("uid-b")).toBeNull();
  });

  it("ignores half-typed details and corrupt or blocked storage", () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    saveDelivery({ ...DETAILS, pincode: "56" }, "uid-a");
    expect(loadSavedDelivery("uid-a")).toBeNull();

    storage.setItem("saker.delivery:uid-a", "{not json");
    expect(loadSavedDelivery("uid-a")).toBeNull();

    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(loadSavedDelivery("uid-a")).toBeNull();
    expect(() => saveDelivery(DETAILS, "uid-a")).not.toThrow();
  });
});
