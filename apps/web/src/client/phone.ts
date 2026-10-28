/**
 * Normalises what a user types into the mobile-number field to E.164. The field starts with "+91",
 * so the common slips are a repeated country code ("+91 91…"), a trunk zero ("+91 0…") or spaces and
 * dashes. Numbers with another country code are passed through (digits only).
 */
export function toE164(input: string): string {
  const trimmed = input.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (!trimmed.startsWith("+") || digits.startsWith("91")) {
    // Indian number: keep the last 10 digits when what precedes them is only "91" and/or "0".
    const national = digits.slice(-10);
    const prefix = digits.slice(0, -10);
    if (national.length === 10 && /^(91)*0?$/.test(prefix)) return `+91${national}`;
  }
  return `+${digits}`;
}
