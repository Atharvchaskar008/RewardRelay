"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { isAddress, parseEther, type Address } from "viem";
import { ErrorText, LoadingCard, Page, RequireSignIn } from "@/components/ui";
import {
  AddressChip,
  Avatar,
  Button,
  Card,
  CopyButton,
  Field,
  Pill,
  Stat,
  inr,
} from "@/components/ds";
import { signOut } from "@/client/firebase";
import { tx, useMe, useSdkContext, useWallet, type TxOutcome } from "@/client/sdk";
import { PWAMobileCard } from "@/components/PWAInstallBanner";

/** Profile: balance in MSTC ≈ ₹, Trust Badge, receive QR, send, withdraw deferred payouts, security. */
export default function WalletPage() {
  return (
    <Page>
      <RequireSignIn>
        <WalletScreen />
      </RequireSignIn>
    </Page>
  );
}

function WalletScreen() {
  const me = useMe();
  const wallet = useWallet();
  const sdk = useSdkContext();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [qr, setQr] = useState<string>("");
  const [result, setResult] = useState<TxOutcome | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const view = me.data;

  useEffect(() => {
    if (view?.address) void QRCode.toDataURL(view.address, { margin: 1, width: 240 }).then(setQr);
  }, [view?.address]);

  async function run(work: () => Promise<TxOutcome | unknown>) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const outcome = await work();
      if (outcome && typeof outcome === "object" && "hash" in outcome)
        setResult(outcome as TxOutcome);
      await me.refetch();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  if (me.isLoading || !wallet.ready) return <LoadingCard lines={4} />;
  if (!view) {
    return (
      <Card className="signin-card">
        <h2 className="title-3">Finish signing up</h2>
        <p className="muted">Create your wallet to get a Trust Badge.</p>
        <Button href="/login">Continue</Button>
      </Card>
    );
  }

  return (
    <div className="stack" style={{ gap: 24 }}>
      <header className="profile-head">
        <Avatar address={view.address} size={72} />
        <div className="stack" style={{ gap: 8 }}>
          <span className="eyebrow">Profile</span>
          <AddressChip address={view.address} href={view.mstscanUrl} />
          <div className="row" style={{ gap: 8 }}>
            <Pill tone="accent">{view.badge.tierName}</Pill>
            <Pill>{wallet.browserWalletName ?? "Crypto wallet"}</Pill>
          </div>
        </div>
      </header>

      <div className="grid" style={{ "--cols": 3 } as React.CSSProperties}>
        <Card>
          <div className="stack" style={{ gap: 16 }}>
            <Stat label="Balance" value={inr(view.balanceInr)} sub={`${view.balanceMstc} MSTC`} />
            {view.withdrawable.wei !== "0" && (
              <div className="stack" style={{ gap: 8 }}>
                <span className="faint" style={{ fontSize: 13 }}>
                  {view.withdrawable.mstc} MSTC waiting
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !wallet.unlocked}
                  onClick={() => run(() => tx.withdraw(sdk().chain))}
                >
                  Withdraw
                </Button>
              </div>
            )}
          </div>
        </Card>
        <Card>
          <div className="stack" style={{ gap: 16 }}>
            <Stat
              label="Trust Badge"
              value={view.badge.tierName}
              sub={`${view.badge.completed} deals · ${view.badge.disputesLost} lost`}
            />
            <Link className="link" href={`/badge/${view.address}`} style={{ fontSize: 14 }}>
              Public badge
            </Link>
          </div>
        </Card>
        <Card>
          <div className="row" style={{ gap: 16, alignItems: "flex-start", flexWrap: "nowrap" }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL QR code */}
            {qr && <img src={qr} alt="Wallet address QR code" width={96} height={96} />}
            <div className="stack" style={{ gap: 8 }}>
              <span className="label">Receive</span>
              <p className="faint" style={{ fontSize: 13 }}>
                Scan or copy your address.
              </p>
              <span className="row" style={{ gap: 4 }}>
                <span className="num" style={{ fontSize: 13 }}>
                  Copy
                </span>
                <CopyButton text={view.address} label="Copy address" />
              </span>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid" style={{ "--cols": 2 } as React.CSSProperties}>
        <Card>
          <div className="stack" style={{ gap: 16 }}>
            <span className="label">Send MSTC</span>
            {!wallet.unlocked ? (
              <p className="muted">
                <Link className="link" href="/login">
                  Connect your wallet
                </Link>{" "}
                to send or withdraw.
              </p>
            ) : (
              <>
                <Field label="To" htmlFor="to">
                  <input
                    id="to"
                    className="input input-mono"
                    value={to}
                    onChange={(e) => setTo(e.target.value.trim())}
                    placeholder="0x…"
                  />
                </Field>
                <Field label="Amount (MSTC)" htmlFor="amount">
                  <input
                    id="amount"
                    className="input input-mono"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.trim())}
                  />
                </Field>
                <Button
                  disabled={busy || !isAddress(to) || !(Number(amount) > 0)}
                  loading={busy}
                  onClick={() =>
                    run(() => tx.sendMstc(sdk().chain, to as Address, parseEther(amount)))
                  }
                >
                  Send
                </Button>
              </>
            )}
            {result && (
              <p className="alert alert-success">
                Sent.&nbsp;
                <a
                  className="link"
                  href={result.explorerUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  View transaction
                </a>
              </p>
            )}
            <ErrorText error={error} />
          </div>
        </Card>

        <Card>
          <div className="stack" style={{ gap: 16 }}>
            <span className="label">Security</span>
            <p className="faint" style={{ fontSize: 13 }}>
              {wallet.kind === "injected"
                ? "Your crypto wallet holds the key."
                : "Your key is encrypted with your PIN on this device, with an encrypted backup."}
            </p>
            <div className="row" style={{ gap: 8 }}>
              {wallet.kind === "injected" ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => wallet.disconnectBrowserWallet()}
                >
                  Disconnect {wallet.browserWalletName}
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!wallet.unlocked || busy}
                    onClick={() => run(() => wallet.backup())}
                  >
                    Back up
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!wallet.unlocked}
                    onClick={() => wallet.lock()}
                  >
                    Lock
                  </Button>
                </>
              )}
              <Button
                variant="danger"
                size="sm"
                onClick={() =>
                  run(async () => {
                    wallet.lock();
                    await signOut();
                  })
                }
              >
                Sign out
              </Button>
            </div>
          </div>
        </Card>
      </div>

      <PWAMobileCard />
    </div>
  );
}
