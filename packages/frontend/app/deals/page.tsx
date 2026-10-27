"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Card, ErrorText, Page, RequireSignIn } from "@/components/ui";
import { useRewardRelay } from "@/src/client/sdk";

/** My deals as Sharer or Seeker, newest first. */
export default function DealsPage() {
  return (
    <Page title="My deals">
      <RequireSignIn>
        <DealList />
      </RequireSignIn>
    </Page>
  );
}

function DealList() {
  const { api } = useRewardRelay();
  const deals = useQuery({
    queryKey: ["my-deals"],
    queryFn: () => api.myDeals(),
    refetchInterval: 10_000,
  });
  if (deals.isLoading) return <p className="muted">Loading…</p>;
  const items = deals.data?.items ?? [];
  return (
    <>
      <ErrorText error={deals.error} />
      {items.length === 0 && (
        <p className="muted">
          No deals yet. <Link href="/explore">Explore offers</Link> or{" "}
          <Link href="/listings/new">share one</Link>.
        </p>
      )}
      <ul className="plain">
        {items.map((item) => (
          <li key={item.dealId}>
            <Card>
              <Link href={`/deal/${item.dealId}`}>
                <strong>{item.title}</strong>
              </Link>
              <p className="muted">
                #{item.dealId} · you are the {item.role} · {item.statusLabel}
              </p>
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}
