import type { Address } from "viem";
import { listBuyForYou, listPassOn, type ListingDraft, type SdkContext } from "@/client/sdk";

/**
 * The demo marketplace: one offer per category, priced within the New-tier limit (₹500) so a fresh
 * Trust Badge can list and buy them. Pass-on offers carry a code prefix; a run suffix keeps each code
 * unique (the Code Vault refuses a code that was ever listed).
 */
export interface DemoListing extends Omit<ListingDraft, "eventTime"> {
  /** Event categories (travel, movies) need a future event time: days from now. */
  eventInDays?: number;
  /** Pass-on only: the shareable code's prefix. */
  codePrefix?: string;
}

export const DEMO_LISTINGS: readonly DemoListing[] = [
  {
    title: "Flipkart card offer – 10% off electronics",
    description:
      "My bank card gives 10% instant discount on Flipkart. Send the product link; I order it from my account to your address and share the order ID and invoice.",
    category: "ecommerce",
    faceValueInr: 444,
    priceInr: 400,
  },
  {
    title: "redBus wallet credit – ₹300 off a bus ticket",
    description:
      "I have unused redBus wallet credit expiring this month. Tell me the route and date; I book the seat in your name and share the PNR.",
    category: "travel",
    faceValueInr: 450,
    priceInr: 300,
    eventInDays: 3,
  },
  {
    title: "Swiggy One member price – ₹150 off dinner",
    description:
      "Swiggy One membership pricing on any restaurant. Share your order; I place it for delivery to your address.",
    category: "food",
    faceValueInr: 300,
    priceInr: 150,
  },
  {
    title: "BookMyShow card offer – second ticket free",
    description:
      "Buy-one-get-one on movie tickets with my card. Pick the show; I book both seats and share the booking ID.",
    category: "movies",
    faceValueInr: 400,
    priceInr: 200,
    eventInDays: 3,
  },
  {
    title: "Amazon Prime member deal – ₹250 off",
    description:
      "Prime-only deal price on the listed item. I order it from my Prime account to your address.",
    category: "membership",
    faceValueInr: 500,
    priceInr: 250,
  },
  {
    title: "Zomato ₹100 off coupon code",
    description: "Unused Zomato code: ₹100 off orders above ₹299, one-time use.",
    category: "coupon",
    faceValueInr: 100,
    priceInr: 40,
    codePrefix: "ZOMATO100",
  },
];

/** Titles of this Sharer's open listings (the public feed, all pages). */
async function openTitles(sdk: SdkContext, sharer: Address): Promise<Set<string>> {
  const titles = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await sdk.api.listings.list({ status: "open", cursor });
    for (const item of page.items) {
      if (item.sharer.toLowerCase() === sharer.toLowerCase()) titles.add(item.title);
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return titles;
}

/**
 * Lists every demo offer this Sharer does not have open yet, so running it again never duplicates.
 * Returns the new deal ids and the titles that were already open.
 */
export async function seedDemoListings(
  sdk: SdkContext,
  sharer: Address,
  options: { now?: number; runSuffix?: string; listings?: readonly DemoListing[] } = {},
): Promise<{ created: string[]; skipped: string[] }> {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const suffix = options.runSuffix ?? now.toString(36).toUpperCase();
  const open = await openTitles(sdk, sharer);
  const created: string[] = [];
  const skipped: string[] = [];
  for (const item of options.listings ?? DEMO_LISTINGS) {
    if (open.has(item.title)) {
      skipped.push(item.title);
      continue;
    }
    const { eventInDays, codePrefix, ...rest } = item;
    const draft: ListingDraft = {
      ...rest,
      eventTime: eventInDays ? now + eventInDays * 24 * 60 * 60 : undefined,
    };
    const { listing } = codePrefix
      ? await listPassOn(sdk, draft, `${codePrefix}-${suffix}`)
      : await listBuyForYou(sdk, draft);
    created.push(listing.dealId);
  }
  return { created, skipped };
}
