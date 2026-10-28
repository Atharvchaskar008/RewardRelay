"use client";

import { useQuery } from "@tanstack/react-query";
import type { CSSProperties } from "react";
import { LoadingCard, Page, isActiveStatus } from "@/components/ui";
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  IconArrowRight,
  Pill,
  SectionHeader,
  Stat,
  inr,
  shortAddress,
} from "@/components/ds";
import { DealRow, OfferCard, OfferCardSkeleton } from "@/components/cards";
import { useListings, useMe, useRewardRelay } from "@/client/sdk";
import { useSession } from "@/app/providers";
import { PixelField } from "@/landing/PixelField";

const DEPOSIT = ["50%", "30%", "20%"];

/** Overview: your balance, badge and deals at a glance, then the newest offers. */
export default function OverviewPage() {
  const { ready, user } = useSession();
  return (
    <Page>
      <div className="stack" style={{ gap: 48 }}>
        {!ready ? <LoadingCard /> : user ? <Account /> : <Welcome />}
        <NewOffers />
      </div>
    </Page>
  );
}

function Welcome() {
  return (
    <Card className="welcome">
      <div className="signin-card" style={{ maxWidth: "none" }}>
        <span className="eyebrow">Welcome to SAKAR</span>
        <h1 className="title-1" style={{ maxWidth: "16ch" }}>
          Card offers, minus the card.
        </h1>
        <p className="lead">
          Sign in with your phone to buy with someone else&apos;s offer, or share your own.
        </p>
        <div className="row" style={{ gap: 12 }}>
          <Button href="/login" size="lg">
            Sign in
          </Button>
          <Button href="/explore" variant="outline" size="lg">
            Explore offers
          </Button>
        </div>
      </div>
      <PixelField className="welcome-field" seed={7} bias={0.04} />
    </Card>
  );
}

function Account() {
  const me = useMe();
  const { api } = useRewardRelay();
  const deals = useQuery({
    queryKey: ["my-deals"],
    queryFn: () => api.myDeals(),
    refetchInterval: 15_000,
  });

  if (me.isLoading) return <LoadingCard lines={4} />;
  if (!me.data) {
    return (
      <Card className="signin-card">
        <h2 className="title-3">Finish signing up</h2>
        <p className="muted">Create your wallet to get a Trust Badge.</p>
        <Button href="/login">Continue</Button>
      </Card>
    );
  }
  const view = me.data;
  const all = deals.data?.items ?? [];
  const active = all.filter((item) => isActiveStatus(item.status));

  return (
    <div className="stack" style={{ gap: 24 }}>
      <header className="row-between">
        <div className="hello">
          <Avatar address={view.address} size={48} />
          <div className="stack" style={{ gap: 4 }}>
            <span className="eyebrow">Overview</span>
            <span className="num">{shortAddress(view.address)}</span>
          </div>
        </div>
        <Button href="/listings/new">Share an offer</Button>
      </header>

      <Card className="stat-group">
        <Stat label="Balance" value={inr(view.balanceInr)} sub={`${view.balanceMstc} MSTC`} />
        <Stat
          label="Trust Badge"
          value={view.badge.tierName}
          sub={`${DEPOSIT[view.tier] ?? DEPOSIT[0]} deposit · ${view.badge.completed} deals`}
        />
        <Stat label="Active deals" value={active.length} sub={`${all.length} in total`} />
      </Card>

      <div className="overview-main">
        <div className="stack">
          <div className="row-between">
            <span className="label">Your deals</span>
            <Button href="/deals" variant="ghost" size="sm">
              All deals <IconArrowRight />
            </Button>
          </div>
          {deals.isLoading ? (
            <LoadingCard lines={3} />
          ) : all.length === 0 ? (
            <EmptyState
              title="No deals yet."
              action={<Button href="/explore">Explore offers</Button>}
            />
          ) : (
            <Card className="list">
              {all.slice(0, 5).map((item) => (
                <DealRow key={item.dealId} item={item} />
              ))}
            </Card>
          )}
        </div>
        <div className="stack">
          <div className="row-between" style={{ minHeight: 32 }}>
            <span className="label">Quick actions</span>
          </div>
          <Card href="/explore" className="quick">
            <Pill tone="accent">Buy</Pill>
            <div className="row-between">
              <span className="title-3">Find an offer</span>
              <IconArrowRight />
            </div>
          </Card>
          <Card href="/listings/new" className="quick">
            <Pill>Share</Pill>
            <div className="row-between">
              <span className="title-3">List your card offer</span>
              <IconArrowRight />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function NewOffers() {
  const listings = useListings({ status: "open" });
  const items = (listings.data?.pages.flatMap((page) => page.items) ?? []).slice(0, 3);
  return (
    <section className="stack" style={{ gap: 24 }}>
      <SectionHeader
        eyebrow="New offers"
        title="Fresh card offers"
        size={3}
        action={
          <Button href="/explore" variant="ghost" size="sm">
            See all <IconArrowRight />
          </Button>
        }
      />
      {listings.isLoading ? (
        <div className="grid" style={{ "--cols": 3 } as CSSProperties}>
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
        <div className="grid" style={{ "--cols": 3 } as CSSProperties}>
          {items.map((item) => (
            <OfferCard key={item.dealId} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}
