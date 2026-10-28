"use client";

import { useParams } from "next/navigation";
import { useEffect, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import QRCode from "qrcode";
import { ErrorText, LoadingCard, Page } from "@/components/ui";
import { AddressChip, Avatar, Card, EmptyState, Pill, Stat, inr } from "@/components/ds";
import { useRewardRelay, type Money as MoneyValue } from "@/client/sdk";

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
export default function BadgePage() {
  const params = useParams<{ address: string }>();
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
    void QRCode.toDataURL(window.location.href, { margin: 1, width: 192 }).then(setQr);
  }, []);

  return (
    <Page>
      {badge.isLoading && <LoadingCard lines={4} />}
      <ErrorText error={badge.error} />
      {badge.data && (
        <div className="stack" style={{ gap: 24 }}>
          <header className="profile-head">
            <Avatar address={badge.data.address} size={72} />
            <div className="stack" style={{ gap: 8 }}>
              <span className="eyebrow">Trust Badge</span>
              <h1 className="title-1">{badge.data.hasBadge ? badge.data.tierName : "No badge"}</h1>
              <div className="row" style={{ gap: 8 }}>
                <AddressChip address={badge.data.address} href={badge.data.mstscanUrl} />
                {badge.data.hasBadge && <Pill tone="accent">Soulbound · ERC-5192</Pill>}
              </div>
            </div>
          </header>

          {badge.data.hasBadge ? (
            <div className="grid" style={{ "--cols": 4 } as CSSProperties}>
              <Card>
                <Stat label="Deals" value={badge.data.completed} />
              </Card>
              <Card>
                <Stat label="Different people" value={badge.data.uniqueCounterparties} />
              </Card>
              <Card>
                <Stat label="Disputes lost" value={badge.data.disputesLost} />
              </Card>
              <Card>
                <Stat
                  label="Volume"
                  value={inr(badge.data.volume.inr)}
                  sub={`${badge.data.volume.mstc} MSTC`}
                />
              </Card>
            </div>
          ) : (
            <EmptyState title="This address has no Trust Badge yet." />
          )}

          <Card>
            <div className="row" style={{ gap: 24, alignItems: "center" }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL QR code */}
              {qr && <img src={qr} alt="QR code of this badge page" width={112} height={112} />}
              <div className="stack" style={{ gap: 8 }}>
                <span className="label">Verify on-chain</span>
                <p className="faint" style={{ fontSize: 14 }}>
                  {badge.data.relayPoints} Relay Points · locked to this address.
                </p>
                <div className="row" style={{ gap: 16 }}>
                  <a
                    className="link"
                    href={badge.data.mstscanUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    Address on mstscan
                  </a>
                  <a
                    className="link"
                    href={badge.data.badgeContractUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    Badge contract
                  </a>
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}
    </Page>
  );
}
