"use client";

import Link from "next/link";
import type { ListingView, MyDealItem } from "@/client/sdk";
import { Avatar, Card, IconChevronRight, Pill, Skeleton, inr } from "@/components/ds";
import { StatusPill } from "@/components/ui";

/** One open offer: category, title, price, saving and the Sharer's trust. */
export function OfferCard({ item }: { item: ListingView }) {
  const saving = Math.max(0, item.faceValueInr - item.priceInr);
  return (
    <Card href={`/deal/${item.dealId}`} className="offer">
      <div className="row-between">
        <Pill>{item.categoryLabel}</Pill>
        <span className="label">{item.dealType === "BuyForYou" ? "Card offer" : "Code"}</span>
      </div>
      <h3 className="offer-title clamp-2">{item.title}</h3>
      <div className="offer-foot">
        <div className="stack" style={{ gap: 2 }}>
          <span className="num" style={{ fontSize: 20 }}>
            {inr(item.priceInr)}
          </span>
          {saving > 0 ? (
            <span className="save">Save {inr(saving)}</span>
          ) : (
            <span className="stat-sub">{item.price.mstc} MSTC</span>
          )}
        </div>
        <span className="who">
          <Avatar address={item.sharer} size={24} />
          {item.sharerTrust.tierName}
        </span>
      </div>
    </Card>
  );
}

export function OfferCardSkeleton() {
  return (
    <Card className="offer">
      <Skeleton height={24} width={96} />
      <Skeleton height={20} />
      <Skeleton height={20} width="70%" />
      <div className="offer-foot">
        <Skeleton height={24} width={80} />
        <Skeleton height={24} width={72} />
      </div>
    </Card>
  );
}

/** One of my deals, as a list row. */
export function DealRow({ item }: { item: MyDealItem }) {
  return (
    <Link href={`/deal/${item.dealId}`} className="list-row">
      <div className="stack" style={{ gap: 2, minWidth: 0 }}>
        <span className="truncate" style={{ fontWeight: 500 }}>
          {item.title}
        </span>
        <span className="faint num" style={{ fontSize: 12 }}>
          #{item.dealId}
        </span>
      </div>
      <span className="label hide-sm">{item.role === "sharer" ? "Sharing" : "Buying"}</span>
      <StatusPill status={item.status} label={item.statusLabel} />
      <IconChevronRight />
    </Link>
  );
}
