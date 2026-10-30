"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ErrorText, Page } from "@/components/ui";
import {
  Avatar,
  Button,
  Card,
  CopyButton,
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
  const [connectingUuid, setConnectingUuid] = useState<string | null>(null);

  useEffect(() => {
    if (!props.busy) setConnectingUuid(null);
  }, [props.busy]);
  if (wallets === null) return <p className="faint">Detecting installed wallets…</p>;

  // Check if window has an injected provider (BridgeKey or window.ethereum)
  const win =
    typeof window !== "undefined" ? (window as unknown as Record<string, unknown>) : undefined;
  const directBk = (win?.bridgekey ??
    win?.bridgeKey ??
    win?.BridgeKey ??
    win?.Bridgekey ??
    win?.mst ??
    win?.MST ??
    win?.mstWallet ??
    win?.mstChain ??
    win?.mstscan ??
    win?.bridgeKeyProvider) as InjectedWallet["provider"] | undefined;

  const directEth = win?.ethereum as
    | (InjectedWallet["provider"] & {
        isMetaMask?: boolean;
        isBridgeKey?: boolean;
        bridgeKey?: boolean;
        isMST?: boolean;
        providers?: (InjectedWallet["provider"] & {
          isBridgeKey?: boolean;
          bridgeKey?: boolean;
          isMST?: boolean;
          name?: string;
        })[];
      })
    | undefined;

  const bkFromProviders = directEth?.providers?.find(
    (p) => p.isBridgeKey || p.bridgeKey || p.isMST || p.name?.toLowerCase().includes("bridgekey"),
  );

  const bkProvider =
    directBk ??
    bkFromProviders ??
    (directEth &&
    (directEth.isBridgeKey || directEth.bridgeKey || directEth.isMST || !directEth.isMetaMask)
      ? directEth
      : undefined);

  const displayWallets = [...(wallets ?? [])];

  // If BridgeKey is detected, ensure it is in displayWallets
  if (bkProvider && !displayWallets.some((w) => w.info.name.toLowerCase().includes("bridgekey"))) {
    displayWallets.unshift({
      info: {
        uuid: "bridgekey-direct-picker",
        name: "BridgeKey",
        icon: "",
        rdns: "io.bridgekey.wallet",
      },
      provider: bkProvider,
    });
  }

  // If MetaMask is installed, ensure it is in displayWallets
  if (
    directEth &&
    directEth.isMetaMask &&
    !displayWallets.some((w) => w.info.name.toLowerCase().includes("metamask"))
  ) {
    displayWallets.push({
      info: {
        uuid: "metamask-direct-picker",
        name: "MetaMask",
        icon: "",
        rdns: "io.metamask",
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
    const isMobile =
      typeof window !== "undefined" && /iPhone|iPad|iPod|Android/i.test(window.navigator.userAgent);

    return (
      <div className="stack" style={{ gap: "var(--s-3)" }}>
        {isMobile ? (
          <>
            <button
              type="button"
              className="wallet-select-option"
              onClick={() => {
                const url =
                  typeof window !== "undefined"
                    ? window.location.href
                    : "https://saker-app.vercel.app/login";

                // Auto copy URL to clipboard for effortless pasting in in-app browser
                if (typeof navigator !== "undefined" && navigator.clipboard) {
                  void navigator.clipboard.writeText(url);
                }

                const isAndroid =
                  typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

                if (isAndroid) {
                  // Direct Android Intent to launch com.bridgekey app with fallback
                  window.location.href = `intent://${url.replace(
                    /^https?:\/\//,
                    "",
                  )}#Intent;package=com.bridgekey;scheme=https;fallback_url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dcom.bridgekey;end`;
                } else {
                  window.location.href = `bridgekey://open?url=${encodeURIComponent(url)}`;
                }
              }}
            >
              <div className="wallet-icon-wrapper" style={{ fontSize: 18 }}>
                🔑
              </div>
              <div className="wallet-text-wrapper">
                <span className="wallet-title">BridgeKey Mobile</span>
                <span className="wallet-subtitle">Launch BridgeKey App · Chain 4646</span>
              </div>
              <IconChevronRight />
            </button>

            <a
              href="https://metamask.app.link/dapp/saker-app.vercel.app/login"
              className="wallet-select-option"
              style={{ textDecoration: "none" }}
            >
              <div className="wallet-icon-wrapper" style={{ fontSize: 18 }}>
                🦊
              </div>
              <div className="wallet-text-wrapper">
                <span className="wallet-title">MetaMask Mobile</span>
                <span className="wallet-subtitle">Open in MetaMask dApp Browser</span>
              </div>
              <IconChevronRight />
            </a>

            <div
              className="stack"
              style={{
                gap: 8,
                padding: "12px 14px",
                background: "var(--canvas)",
                border: "1px solid var(--line)",
                borderRadius: "var(--radius-card)",
                marginTop: 4,
              }}
            >
              <div className="row-between">
                <span className="label" style={{ fontSize: 11, textTransform: "uppercase" }}>
                  In-App Browser Setup
                </span>
                <span className="pill pill-subtle" style={{ fontSize: 10 }}>
                  Recommended
                </span>
              </div>
              <p className="faint" style={{ fontSize: 13, lineHeight: 1.5, margin: 0 }}>
                For the smoothest experience, open the <strong>BridgeKey App</strong> on your phone,
                tap the <strong>Browser 🧭</strong> tab, and paste:
              </p>
              <div className="row" style={{ gap: 8, alignItems: "center" }}>
                <code
                  style={{
                    fontSize: 12,
                    padding: "4px 8px",
                    background: "var(--surface)",
                    border: "1px solid var(--line)",
                    borderRadius: 4,
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  https://saker-app.vercel.app
                </code>
                <CopyButton text="https://saker-app.vercel.app" label="Copy" />
              </div>
            </div>
          </>
        ) : (
          <>
            <p className="alert alert-warning" style={{ fontSize: "14px" }}>
              No browser extension detected. Please unlock or install <strong>BridgeKey</strong> or{" "}
              <strong>MetaMask</strong> in your browser to continue.
            </p>
            <div className="row" style={{ gap: 8 }}>
              <a
                href="https://bridgekey.io"
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary btn-block"
                style={{ flex: 1, textDecoration: "none" }}
              >
                Get BridgeKey
              </a>
              <a
                href="https://metamask.io/download/"
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-outline btn-block"
                style={{ flex: 1, textDecoration: "none" }}
              >
                Get MetaMask
              </a>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: "var(--s-2)" }}>
      {displayWallets.map((candidate) => {
        const isConnecting = props.busy && connectingUuid === candidate.info.uuid;
        return (
          <button
            key={candidate.info.uuid}
            type="button"
            className={`wallet-select-option ${isConnecting ? "wallet-select-option-active" : ""}`}
            disabled={props.busy}
            onClick={() => {
              setConnectingUuid(candidate.info.uuid);
              props.onPick(candidate);
            }}
          >
            <div className="wallet-icon-wrapper">
              {isConnecting ? (
                <span
                  className="spinner"
                  style={{
                    width: 20,
                    height: 20,
                    border: "2px solid var(--accent)",
                    borderRightColor: "transparent",
                    borderRadius: "50%",
                    display: "inline-block",
                    animation: "spin 700ms linear infinite",
                  }}
                />
              ) : candidate.info.icon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={candidate.info.icon} alt="" width={28} height={28} />
              ) : (
                <Avatar size={28} />
              )}
            </div>
            <div className="wallet-text-wrapper">
              <span className="wallet-title">
                {isConnecting ? `Opening ${candidate.info.name}…` : candidate.info.name}
              </span>
              <span className="wallet-subtitle">
                {isConnecting
                  ? "Approve the prompt in your extension"
                  : "MST Blockchain Compatible"}
              </span>
            </div>
            <IconChevronRight />
          </button>
        );
      })}
      <p className="faint" style={{ fontSize: "12px", textAlign: "center", margin: "4px 0 0" }}>
        Please unlock your wallet extension with your password/PIN before connecting.
      </p>
    </div>
  );
}
