"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ErrorText, LoadingCard, Page, RequireSignIn, isActiveStatus } from "@/components/ui";
import { Button, Card, EmptyState } from "@/components/ds";
import { DealRow } from "@/components/cards";
import { useRewardRelay } from "@/client/sdk";

/** My deals as Sharer or Seeker, newest first. */
export default function DealsPage() {
  return (
    <Page eyebrow="Deals" title="My deals">
      <RequireSignIn>
        <DealList />
      </RequireSignIn>
    </Page>
  );
}

function DealList() {
  const { api } = useRewardRelay();
  const [tab, setTab] = useState<"active" | "done">("active");
  const deals = useQuery({
    queryKey: ["my-deals"],
    queryFn: () => api.myDeals(),
    refetchInterval: 10_000,
  });
  if (deals.isLoading) return <LoadingCard lines={4} />;
  const all = deals.data?.items ?? [];
  const items = all.filter((item) => (tab === "active") === isActiveStatus(item.status));
  const activeCount = all.filter((item) => isActiveStatus(item.status)).length;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="segmented" role="group" aria-label="Filter">
        <button type="button" aria-pressed={tab === "active"} onClick={() => setTab("active")}>
          Active · {activeCount}
        </button>
        <button type="button" aria-pressed={tab === "done"} onClick={() => setTab("done")}>
          Done · {all.length - activeCount}
        </button>
      </div>
      <ErrorText error={deals.error} />
      {items.length === 0 ? (
        <EmptyState
          title={tab === "active" ? "No active deals." : "No finished deals yet."}
          action={<Button href="/explore">Explore offers</Button>}
        />
      ) : (
        <Card className="list">
          {items.map((item) => (
            <DealRow key={item.dealId} item={item} />
          ))}
        </Card>
      )}
    </div>
  );
}
