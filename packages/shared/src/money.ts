/**
 * MSTC ↔ ₹ conversions at the demo rate (₹ per 1 MSTC), in exact integer arithmetic.
 * ₹ amounts are handled in paise (1/100 ₹) internally, so ₹1,530 at ₹1,00,000/MSTC is exactly
 * 0.0153 MSTC = 15_300_000_000_000_000 wei.
 */

const WEI_PER_MSTC = 10n ** 18n;
/** The rate may have up to 6 decimals; it is scaled to an integer of micro-rupees. */
const RATE_SCALE = 1_000_000n;

function scaledRate(inrPerMstc: number): bigint {
  if (!Number.isFinite(inrPerMstc) || inrPerMstc <= 0) throw new Error("rate must be positive");
  return BigInt(Math.round(inrPerMstc * Number(RATE_SCALE)));
}

/** ₹ (up to 2 decimals) → wei, rounded down to the nearest wei. */
export function inrToWei(inr: number, inrPerMstc: number): bigint {
  if (!Number.isFinite(inr) || inr < 0) throw new Error("amount must be a non-negative number");
  const paise = BigInt(Math.round(inr * 100));
  return (paise * WEI_PER_MSTC * RATE_SCALE) / (100n * scaledRate(inrPerMstc));
}

/** wei → ₹, rounded to paise. */
export function weiToInr(wei: bigint, inrPerMstc: number): number {
  const paise =
    (wei * scaledRate(inrPerMstc) * 100n + (WEI_PER_MSTC * RATE_SCALE) / 2n) /
    (WEI_PER_MSTC * RATE_SCALE);
  return Number(paise) / 100;
}

/** wei → decimal MSTC string without trailing zeros (e.g. "0.0153"). */
export function weiToMstc(wei: bigint): string {
  const negative = wei < 0n;
  const abs = negative ? -wei : wei;
  const whole = abs / WEI_PER_MSTC;
  const fraction = (abs % WEI_PER_MSTC).toString().padStart(18, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

/** "X MSTC (≈ ₹Y)" as shown everywhere in the UI. */
export function formatMstcInr(wei: bigint, inrPerMstc: number): string {
  const inr = weiToInr(wei, inrPerMstc).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  return `${weiToMstc(wei)} MSTC (≈ ₹${inr})`;
}
