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
    title: "10% off on Flipkart with an HDFC card",
    description:
      "Send me the product link. I order it in my account with my HDFC card and ship it to you, with the order id and invoice.",
    category: "ecommerce",
    faceValueInr: 444,
    priceInr: 400,
  },
  {
    title: "₹150 off a Pune–Mumbai bus with an ICICI card",
    description:
      "Tell me the date and seat. I book it in your name with my card offer and share the PNR.",
    category: "travel",
    faceValueInr: 600,
    priceInr: 450,
    eventInDays: 3,
  },
  {
    title: "Swiggy: 20% off dinner with an Axis card",
    description:
      "Share your cart. I place the order with my card offer for delivery to your address.",
    category: "food",
    faceValueInr: 300,
    priceInr: 240,
  },
  {
    title: "BookMyShow: buy 1, get 1 with a Kotak card",
    description: "Pick the show. I book both seats with my card and share the booking id.",
    category: "movies",
    faceValueInr: 400,
    priceInr: 200,
    eventInDays: 3,
  },
  {
    title: "Prime member price on your order",
    description:
      "Members-only deal price on the listed item. I order it from my account to your address.",
    category: "membership",
    faceValueInr: 500,
    priceInr: 350,
  },
  {
    title: "Myntra 15% off code",
    description: "Unused Myntra code: 15% off orders above ₹999, one-time use.",
    category: "coupon",
    faceValueInr: 150,
    priceInr: 40,
    codePrefix: "MYNTRA15",
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
