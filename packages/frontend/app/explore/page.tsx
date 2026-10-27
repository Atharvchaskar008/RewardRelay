"use client";

import Link from "next/link";
import { useState } from "react";
import { CATEGORIES, CATEGORY_LABELS } from "rewardrelay-shared";
import { Card, ErrorText, Money, Page } from "@/components/ui";
import { useListings } from "@/src/client/sdk";

/** The offer board: open listings, filter by category, ₹ price and the Sharer's trust level. */
export default function ExplorePage() {
  const [category, setCategory] = useState("");
  const listings = useListings({ category: category || undefined, status: "open" });
  const items = listings.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Page title="Explore offers">
      <label htmlFor="category">Category</label>
      <select id="category" value={category} onChange={(e) => setCategory(e.target.value)}>
        <option value="">All categories</option>
        {CATEGORIES.map((entry) => (
          <option key={entry.key} value={entry.key}>
            {CATEGORY_LABELS[entry.key]}
          </option>
        ))}
      </select>

      {listings.isLoading && <p className="muted">Loading…</p>}
      <ErrorText error={listings.error} />
      {!listings.isLoading && items.length === 0 && (
        <p className="muted">No open offers right now.</p>
      )}

      <ul className="plain">
        {items.map((item) => (
          <li key={item.dealId}>
            <Card>
              <Link href={`/deal/${item.dealId}`}>
                <strong>{item.title}</strong>
              </Link>
              <p className="muted">
                {item.categoryLabel} ·{" "}
                {item.dealType === "BuyForYou" ? "Buy-for-you" : "Pass-on code"}
              </p>
              <p>
                Pay <Money value={item.price} />
                {item.faceValueInr > 0 && (
                  <span className="muted">
                    {" "}
                    · worth ₹{item.faceValueInr.toLocaleString("en-IN")}
                  </span>
                )}
              </p>
              <p className="muted">
                Sharer: {item.sharerTrust.tierName} · {item.sharerTrust.completed} deals completed
              </p>
            </Card>
          </li>
        ))}
      </ul>
      {listings.hasNextPage && (
        <button disabled={listings.isFetchingNextPage} onClick={() => listings.fetchNextPage()}>
          Load more
        </button>
      )}
    </Page>
  );
}
