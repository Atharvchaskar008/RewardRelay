import { isAddress, type Address } from "viem";

/**
 * Which wallet this browser signs with, remembered between visits: the PIN-protected device wallet
 * (the default) or a browser wallet identified by its EIP-6963 `rdns`. Storage can be unavailable
 * (private windows, blocked site data), so every access is guarded and "no choice" is the fallback.
 */

export type WalletChoice =
  { kind: "embedded" } | { kind: "injected"; rdns: string; name: string; address: Address };

const KEY = "rewardrelay.wallet";

export function loadWalletChoice(): WalletChoice | null {
  try {
    const parsed: unknown = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? "null");
    if (!parsed || typeof parsed !== "object") return null;
    const choice = parsed as Record<string, unknown>;
    if (choice.kind === "embedded") return { kind: "embedded" };
    if (
      choice.kind === "injected" &&
      typeof choice.rdns === "string" &&
      typeof choice.name === "string" &&
      typeof choice.address === "string" &&
      isAddress(choice.address)
    ) {
      return { kind: "injected", rdns: choice.rdns, name: choice.name, address: choice.address };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveWalletChoice(choice: WalletChoice): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(choice));
  } catch {
    // Not remembered: the user picks the wallet again next time.
  }
}

export function clearWalletChoice(): void {
  try {
    globalThis.localStorage?.removeItem(KEY);
  } catch {
    // Nothing stored or storage unavailable.
  }
}
