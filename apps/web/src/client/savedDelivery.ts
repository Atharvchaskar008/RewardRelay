import { deliveryDetailsSchema, type DeliveryDetails } from "@/common/deliveryDetails";

/**
 * The last complete delivery address, kept on this device per account, so a buyer can pay without
 * typing it again (typing can be unavailable, e.g. while screen sharing from a wallet's in-app
 * browser). Storage can be unavailable, so every access is guarded and "nothing saved" is the fallback.
 */

const KEY = "saker.delivery";
const keyFor = (accountId?: string | null) => (accountId ? `${KEY}:${accountId}` : KEY);

export function loadSavedDelivery(accountId?: string | null): DeliveryDetails | null {
  try {
    const saved: unknown = JSON.parse(
      globalThis.localStorage?.getItem(keyFor(accountId)) ?? "null",
    );
    const parsed = deliveryDetailsSchema.safeParse(saved);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Remembers the details once they are complete; anything half-typed is ignored. */
export function saveDelivery(details: DeliveryDetails, accountId?: string | null): void {
  const parsed = deliveryDetailsSchema.safeParse(details);
  if (!parsed.success) return;
  try {
    globalThis.localStorage?.setItem(keyFor(accountId), JSON.stringify(parsed.data));
  } catch {
    // Not remembered: the user types the address again next time.
  }
}
