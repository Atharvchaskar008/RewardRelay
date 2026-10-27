import { afterEach, describe, expect, it, vi } from "vitest";
import { recoverMessageAddress, parseTransaction, recoverTransactionAddress } from "viem";
import {
  EmbeddedWallet,
  MemoryKeyStore,
  PBKDF2_ITERATIONS,
  WalletLockedError,
  WrongPinError,
  decryptPrivateKey,
  validatePin,
} from "@/src/client/wallet";

afterEach(() => {
  vi.useRealTimers();
});

describe("embedded wallet", () => {
  it("creates a key, stores it encrypted only, and signs while unlocked", async () => {
    const store = new MemoryKeyStore();
    const wallet = new EmbeddedWallet(store);
    const { address, backup } = await wallet.create("246810");

    expect(backup.kdf).toEqual({ name: "PBKDF2", iterations: PBKDF2_ITERATIONS, hash: "SHA-256" });
    expect(Buffer.from(backup.iv, "base64")).toHaveLength(12);
    expect(Buffer.from(backup.ciphertext, "base64")).toHaveLength(48);
    const privateKey = await decryptPrivateKey(backup, "246810");
    const stored = JSON.stringify(await store.load());
    expect(stored).not.toContain(privateKey.slice(2));
    expect(stored).not.toContain(privateKey.slice(2).toUpperCase());

    const signature = await wallet.signMessage("hello");
    expect(await recoverMessageAddress({ message: "hello", signature })).toBe(address);

    const raw = await wallet.signTransaction({
      type: "legacy",
      chainId: 91562037,
      nonce: 0,
      to: address,
      value: 1n,
      gas: 21_000n,
      gasPrice: 1_000_000_000n,
    });
    expect(parseTransaction(raw).gasPrice).toBe(1_000_000_000n);
    expect(await recoverTransactionAddress({ serializedTransaction: raw as never })).toBe(address);
  });

  it("locks, refuses a wrong PIN and unlocks with the right one", async () => {
    const wallet = new EmbeddedWallet(new MemoryKeyStore());
    const { address } = await wallet.create("112233");
    wallet.lock();
    expect(wallet.isUnlocked()).toBe(false);
    expect(() => wallet.getAccount()).toThrow(WalletLockedError);
    await expect(wallet.unlock("999999")).rejects.toBeInstanceOf(WrongPinError);
    expect(await wallet.unlock("112233")).toBe(address);
    expect(wallet.getAccount().address).toBe(address);
  });

  it("auto-locks after the idle timeout, and each use resets it", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const wallet = new EmbeddedWallet(new MemoryKeyStore(), { idleMs: 1_000 });
    await wallet.create("445566");
    const locked = vi.fn();
    wallet.onLock(locked);

    vi.advanceTimersByTime(800);
    wallet.getAccount(); // use → timer restarts
    vi.advanceTimersByTime(800);
    expect(wallet.isUnlocked()).toBe(true);
    vi.advanceTimersByTime(300);
    expect(wallet.isUnlocked()).toBe(false);
    expect(locked).toHaveBeenCalledOnce();
  });

  it("restores a backup on a new device only with the right PIN", async () => {
    const original = new EmbeddedWallet(new MemoryKeyStore());
    const { address, backup } = await original.create("778899");

    const store = new MemoryKeyStore();
    const device = new EmbeddedWallet(store);
    await expect(device.restore(backup, "000000")).rejects.toBeInstanceOf(WrongPinError);
    expect(await store.load()).toBeNull();
    expect(await device.restore(backup, "778899")).toBe(address);
    expect(await device.storedAddress()).toBe(address);
  });

  it("detects a backup whose address was swapped", async () => {
    const a = await new EmbeddedWallet(new MemoryKeyStore()).create("123123");
    const b = await new EmbeddedWallet(new MemoryKeyStore()).create("123123");
    await expect(
      decryptPrivateKey({ ...a.backup, address: b.address }, "123123"),
    ).rejects.toBeInstanceOf(WrongPinError);
  });

  it("enforces the PIN format and one wallet per device", async () => {
    expect(() => validatePin("12345")).toThrow();
    expect(() => validatePin("12345a")).toThrow();
    expect(() => validatePin("123456")).not.toThrow();
    const wallet = new EmbeddedWallet(new MemoryKeyStore());
    await wallet.create("123456");
    await expect(wallet.create("123456")).rejects.toThrow(/already exists/);
  });
});
