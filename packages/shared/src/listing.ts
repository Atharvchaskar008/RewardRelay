import { CATEGORIES, type CategoryKey } from "./categories";

/**
 * Listing rules shared by the server (enforcement) and the UI (early feedback):
 * the category allowlist, the blocked topics, Pass-on code normalisation and the canonical terms
 * whose keccak256 is committed on-chain as `termsHash` (anti bait-and-switch).
 */

export const CATEGORY_LABELS: Record<CategoryKey, string> = {
  ecommerce: "Shopping card offers",
  travel: "Travel credits and bookings",
  food: "Food and quick commerce",
  movies: "Movies and events",
  membership: "Membership prices",
  coupon: "Shareable codes and vouchers",
};

export function categoryByKey(key: string) {
  return CATEGORIES.find((category) => category.key === key);
}

export function categoryById(id: number) {
  return CATEGORIES.find((category) => category.id === id);
}

/** Never offered on RewardRelay (terms page + server-side keyword screening). */
export const BLOCKED_TOPICS = [
  {
    key: "wallet-cash-out",
    label: "Cashing out wallet balances",
    pattern:
      /\b(cash[\s-]?out|cash back to bank|withdraw (the )?balance|wallet (balance )?to (bank|cash))\b/i,
  },
  {
    key: "employee-student",
    label: "Employee, staff or student-only discounts",
    pattern:
      /\b(employee|staff|corporate|student)(-only)? (discount|price|pricing|offer|perk|id)s?\b/i,
  },
  {
    key: "irctc",
    label: "IRCTC and railway tickets",
    pattern: /\b(irctc|railway ticket|train ticket|tatkal)\b/i,
  },
  {
    key: "account-sharing",
    label: "Sharing accounts, logins, passwords or OTPs",
    pattern:
      /\b(account sharing|share (my )?(account|login)|login (details|credentials)|password|otp|one[\s-]time password)\b/i,
  },
  {
    key: "regulated-goods",
    label: "Regulated goods (alcohol, tobacco, medicines, weapons, gambling)",
    pattern:
      /\b(alcohol|liquor|beer|wine|whisk(e)?y|vodka|tobacco|cigarettes?|vapes?|e-cig|prescription|medicines?|drugs?|firearms?|guns?|ammunition|gambling|betting|lottery|casino)\b/i,
  },
] as const;

/** Returns the blocked topic a text mentions, if any. */
export function findBlockedTopic(...texts: string[]): (typeof BLOCKED_TOPICS)[number] | undefined {
  const text = texts.join("\n");
  return BLOCKED_TOPICS.find((topic) => topic.pattern.test(text));
}

/** Pass-on code normalisation (trim, uppercase, strip whitespace) before fingerprinting. */
export function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

export const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,63}$/;

/** JSON with recursively sorted keys and no whitespace: one byte string per value. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("non-finite number");
    if (typeof value === "bigint") return JSON.stringify(value.toString());
    if (value === undefined) throw new Error("undefined is not allowed in canonical JSON");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, inner]) => inner !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, inner]) => `${JSON.stringify(key)}:${canonicalJson(inner)}`).join(",")}}`;
}

/** Everything a listing shows; its canonical JSON is what `termsHash` commits to. */
export interface ListingTerms {
  version: 1;
  title: string;
  description: string;
  category: string;
  faceValueInr: number;
  priceInr: number;
  /** Event (journey/show) time in seconds since epoch, or 0. */
  eventTime: number;
  /** Free-form conditions shown to the seeker (validity, brands, delivery notes...). */
  conditions: Record<string, unknown>;
}

export function buildListingTerms(input: Omit<ListingTerms, "version">): ListingTerms {
  return {
    version: 1,
    title: input.title,
    description: input.description,
    category: input.category,
    faceValueInr: input.faceValueInr,
    priceInr: input.priceInr,
    eventTime: input.eventTime,
    conditions: input.conditions,
  };
}
