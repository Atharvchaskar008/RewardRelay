"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import QRCode from "qrcode";
import { Card, ErrorText, ExplorerLink, Money, Page } from "@/components/ui";
import { useRewardRelay, type Money as MoneyValue } from "@/src/client/sdk";

interface BadgeView {
  address: string;
  hasBadge: boolean;
  tokenId: string;
  locked: boolean;
  tierName: string;
  completed: number;
  disputesLost: number;
  uniqueCounterparties: number;
  relayPoints: string;
  volume: MoneyValue;
  maxDealValue: MoneyValue;
  mstscanUrl: string;
  badgeContractUrl: string;
}

/** Public Trust Badge: tier, deals, Relay Points, soulbound (locked), QR to verify. */
export default function BadgePage({ params }: { params: { address: string } }) {
  const { api } = useRewardRelay();
  const badge = useQuery({
    queryKey: ["badge", params.address],
    queryFn: () =>
      api.request<BadgeView>("GET", `/api/badges/${encodeURIComponent(params.address)}`, {
        auth: false,
      }),
  });
  const [qr, setQr] = useState("");
  useEffect(() => {
    void QRCode.toDataURL(window.location.href, { margin: 1, width: 180 }).then(setQr);
  }, []);

  return (
    <Page title="Trust Badge">
      {badge.isLoading && <p className="muted">Loading…</p>}
      <ErrorText error={badge.error} />
      {badge.data && (
        <Card>
          <p className="mono">{badge.data.address}</p>
          {badge.data.hasBadge ? (
            <>
              <p>
                <strong>{badge.data.tierName}</strong> · soulbound (ERC-5192, locked)
              </p>
              <p>
                {badge.data.completed} deals completed with {badge.data.uniqueCounterparties}{" "}
                different people · {badge.data.disputesLost} disputes lost ·{" "}
                {badge.data.relayPoints} Relay Points
              </p>
              <p>
                Volume <Money value={badge.data.volume} /> · deal limit{" "}
                <Money value={badge.data.maxDealValue} />
              </p>
            </>
          ) : (
            <p>This address has no Trust Badge.</p>
          )}
          <p className="row">
            <ExplorerLink href={badge.data.mstscanUrl}>Address on mstscan</ExplorerLink>
            <ExplorerLink href={badge.data.badgeContractUrl}>Badge contract</ExplorerLink>
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL QR code */}
          {qr && <img src={qr} alt="QR code of this badge page" width={180} height={180} />}
        </Card>
      )}
    </Page>
  );
}
