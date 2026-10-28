"use client";

import { useState } from "react";
import { CATEGORIES, CATEGORY_LABELS } from "@rewardrelay/shared";
import { ErrorText, Page } from "@/components/ui";
import { Button, EmptyState } from "@/components/ds";
import { OfferCard, OfferCardSkeleton } from "@/components/cards";
import { useListings } from "@/client/sdk";

/** The offer board: open listings, filter by category, ₹ price and the Sharer's trust level. */
export default function ExplorePage() {
  const [category, setCategory] = useState("");
  const listings = useListings({ category: category || undefined, status: "open" });
  const items = listings.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Page
      eyebrow="Offers"
      title="Explore"
      action={
        <Button href="/listings/new" variant="outline">
          Share an offer
        </Button>
      }
    >
      <div className="stack" style={{ gap: 24 }}>
        <div className="chips" role="group" aria-label="Category">
          <button
            type="button"
            className="chip"
            aria-pressed={category === ""}
            onClick={() => setCategory("")}
          >
            All
          </button>
          {CATEGORIES.map((entry) => (
            <button
              key={entry.key}
              type="button"
              className="chip"
              aria-pressed={category === entry.key}
              onClick={() => setCategory(entry.key)}
            >
              {CATEGORY_LABELS[entry.key]}
            </button>
          ))}
        </div>

        <ErrorText error={listings.error} />
        {listings.isLoading ? (
          <div className="grid" style={{ "--cols": 3 } as React.CSSProperties}>
            {[0, 1, 2].map((i) => (
              <OfferCardSkeleton key={i} />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            title="No open offers yet."
            action={<Button href="/listings/new">Share an offer</Button>}
          />
        ) : (
          <div className="grid" style={{ "--cols": 3 } as React.CSSProperties}>
            {items.map((item) => (
              <OfferCard key={item.dealId} item={item} />
            ))}
          </div>
        )}
        {listings.hasNextPage && (
          <div>
            <Button
              variant="outline"
              loading={listings.isFetchingNextPage}
              onClick={() => listings.fetchNextPage()}
            >
              Load more
            </Button>
          </div>
        )}
      </div>
    </Page>
  );
}
