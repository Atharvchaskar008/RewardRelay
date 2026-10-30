"use client";

import { useState } from "react";
import Link from "next/link";
import { ErrorText, Page } from "@/components/ui";
import {
  Avatar,
  Button,
  Card,
  IconArrowLeft,
  IconChevronRight,
  Stat,
  inr,
  shortAddress,
} from "@/components/ds";
import { useBrowserWallets, useMe, useWallet, type InjectedWallet } from "@/client/sdk";

export default function LoginPage() {
  const wallet = useWallet();
  const me = useMe();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function runConnect(work: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page>
      <div className="auth-split-layout">
        {/* Left column: Pure Web3 Sign in Bar */}
        <div className="auth-split-left">
          <Card className="auth-card auth-panel">
            <div className="stack" style={{ gap: "var(--s-4)" }}>
              <Link href="/" className="auth-back-link" title="Return to landing page">
                <IconArrowLeft />
                <span>Return to landing page</span>
              </Link>

              <div className="stack" style={{ gap: "var(--s-2)" }}>
                <span className="auth-badge-pill">SAKER ESCROW</span>
                <h1 className="title-2" style={{ fontSize: "28px", letterSpacing: "-0.02em" }}>
                  {me.data && wallet.unlocked ? "Connected" : "Sign in"}
                </h1>
                <p className="muted" style={{ fontSize: "14px", lineHeight: "1.5" }}>
                  {me.data && wallet.unlocked
                    ? "Your wallet is securely connected and verified on MST Blockchain."
                    : "Connect your BridgeKey or MetaMask wallet to sign in, verify your Trust Badge, and participate in peer-to-peer escrow deals."}
                </p>
              </div>
            </div>

            {wallet.ready && me.data && wallet.unlocked ? (
              <div className="stack" style={{ gap: "var(--s-5)" }}>
                <div className="hello">
                  <Avatar address={me.data.address} size={48} />
                  <div className="stack" style={{ gap: 2 }}>
                    <span className="num">{shortAddress(me.data.address)}</span>
                    <span className="faint" style={{ fontSize: 13 }}>
                      Signing with {wallet.browserWalletName ?? "Crypto wallet"}
                    </span>
                  </div>
                </div>

                <div className="grid" style={{ "--cols": 2 } as React.CSSProperties}>
                  <Stat label="Trust Badge" value={me.data.badge.tierName} />
                  <Stat
                    label="Balance"
                    value={inr(me.data.balanceInr)}
                    sub={`${me.data.balanceMstc} MSTC`}
                  />
                </div>

                <div className="stack" style={{ gap: "var(--s-3)" }}>
                  <Button href="/explore" block size="lg">
                    Explore offers
                  </Button>
                  <Button href="/dashboard" variant="outline" block>
                    Go to overview
                  </Button>
                  <Button
                    variant="ghost"
                    block
                    disabled={busy}
                    onClick={() =>
                      runConnect(() => Promise.resolve(wallet.disconnectBrowserWallet()))
                    }
                  >
                    Disconnect wallet
                  </Button>
                </div>
              </div>
            ) : (
              <div className="stack" style={{ gap: "var(--s-4)" }}>
                <div className="stack" style={{ gap: "var(--s-3)" }}>
                  <span className="label">Choose your wallet</span>
                  <BrowserWalletPicker
                    busy={busy}
                    onPick={(picked) => runConnect(() => wallet.connectBrowserWallet(picked, null))}
                  />
                </div>

                <div className="row" style={{ alignItems: "center", gap: 12, margin: "4px 0" }}>
                  <div style={{ flex: 1, height: 1, background: "var(--line)" }} />
                  <span
                    className="faint"
                    style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em" }}
                  >
                    or explore
                  </span>
                  <div style={{ flex: 1, height: 1, background: "var(--line)" }} />
                </div>

                <Button href="/dashboard" variant="outline" block size="md">
                  Enter Guest Mode &rarr;
                </Button>

                <ErrorText error={error} />
              </div>
            )}
          </Card>
        </div>

        {/* Right column: Classical Artwork */}
        <div className="auth-split-right">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/art-desert.jpg"
            alt="Alexander the Great in the desert"
            className="auth-art-image"
          />
        </div>
      </div>
    </Page>
  );
}

function BrowserWalletPicker(props: { busy: boolean; onPick: (wallet: InjectedWallet) => void }) {
  const wallets = useBrowserWallets();
  if (wallets === null) return <p className="faint">Detecting installed wallets…</p>;

  // Check if window has an injected provider (BridgeKey or window.ethereum)
  const win =
    typeof window !== "undefined" ? (window as unknown as Record<string, unknown>) : undefined;
  const directBk = (win?.bridgekey ??
    win?.bridgeKey ??
    win?.BridgeKey ??
    win?.Bridgekey ??
    win?.mst ??
    win?.MST) as InjectedWallet["provider"] | undefined;
  const directEth = win?.ethereum as
    (InjectedWallet["provider"] & { isMetaMask?: boolean }) | undefined;

  const displayWallets = [...(wallets ?? [])];

  // If BridgeKey is in window but not in EIP-6963 list, prepend it
  if (directBk && !displayWallets.some((w) => w.info.name.toLowerCase().includes("bridgekey"))) {
    displayWallets.unshift({
      info: {
        uuid: "bridgekey-direct-picker",
        name: "BridgeKey",
        icon: "",
        rdns: "io.bridgekey.wallet",
      },
      provider: directBk,
    });
  }

  // If window.ethereum exists and BridgeKey is still not in the list, offer BridgeKey option
  if (directEth && !displayWallets.some((w) => w.info.name.toLowerCase().includes("bridgekey"))) {
    displayWallets.unshift({
      info: {
        uuid: "bridgekey-injected-picker",
        name: "BridgeKey",
        icon: "",
        rdns: "io.bridgekey.wallet",
      },
      provider: directEth,
    });
  }

  // If no wallets were found via EIP-6963 but window.ethereum exists, provide direct option
  if (displayWallets.length === 0 && directEth) {
    displayWallets.push({
      info: {
        uuid: "injected-direct-picker",
        name: directEth.isMetaMask ? "MetaMask" : "BridgeKey",
        icon: "",
        rdns: "io.injected.wallet",
      },
      provider: directEth,
    });
  }

  if (displayWallets.length === 0) {
    return (
      <div className="stack" style={{ gap: "var(--s-3)" }}>
        <p className="alert alert-warning" style={{ fontSize: "14px" }}>
          No browser wallet detected. Install <strong>BridgeKey</strong> or{" "}
          <strong>MetaMask</strong> to continue.
        </p>
        <a
          href="https://metamask.io/download/"
          target="_blank"
          rel="noopener noreferrer"
          className="button button-outline button-block"
        >
          Download MetaMask
        </a>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: "var(--s-2)" }}>
      {displayWallets.map((candidate) => (
        <button
          key={candidate.info.uuid}
          type="button"
          className="wallet-select-option"
          disabled={props.busy}
          onClick={() => props.onPick(candidate)}
        >
          <div className="wallet-icon-wrapper">
            {candidate.info.icon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={candidate.info.icon} alt="" width={28} height={28} />
            ) : (
              <Avatar size={28} />
            )}
          </div>
          <div className="wallet-text-wrapper">
            <span className="wallet-title">{candidate.info.name}</span>
            <span className="wallet-subtitle">MST Blockchain Compatible</span>
          </div>
          <IconChevronRight />
        </button>
      ))}
    </div>
  );
}
