"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { isAddress, parseEther, type Address } from "viem";
import { Card, ErrorText, ExplorerLink, Money, Page, RequireSignIn } from "@/components/ui";
import { signOut } from "@/client/firebase";
import { tx, useMe, useSdkContext, useWallet, type TxOutcome } from "@/client/sdk";

/** Balance in MSTC ≈ ₹, receive QR, send, withdraw deferred payouts, lock and backup. */
export default function WalletPage() {
  return (
    <Page title="Wallet">
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
  const [pin, setPin] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [qr, setQr] = useState<string>("");
  const [result, setResult] = useState<TxOutcome | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const view = me.data;

  useEffect(() => {
    if (view?.address) void QRCode.toDataURL(view.address, { margin: 1, width: 200 }).then(setQr);
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

  if (me.isLoading || !wallet.ready) return <p className="muted">Loading…</p>;
  if (!view) {
    return (
      <p>
        No wallet linked yet. <Link href="/login">Finish signing up</Link>.
      </p>
    );
  }

  return (
    <>
      <Card>
        <p>
          Balance{" "}
          <Money value={{ wei: view.balanceWei, mstc: view.balanceMstc, inr: view.balanceInr }} />
        </p>
        {view.withdrawable.wei !== "0" && (
          <p>
            Waiting to be withdrawn: <Money value={view.withdrawable} />
            <button
              disabled={busy || !wallet.unlocked}
              onClick={() => run(() => tx.withdraw(sdk().chain))}
            >
              Withdraw
            </button>
          </p>
        )}
        <p>
          Trust Badge: <Link href={`/badge/${view.address}`}>{view.badge.tierName}</Link> ·{" "}
          {view.badge.completed} completed · limit <Money value={view.badge.maxDealValue} />
        </p>
        <p className="mono">{view.address}</p>
        <ExplorerLink href={view.mstscanUrl}>View on mstscan</ExplorerLink>
      </Card>

      <Card>
        <h2>Receive</h2>
        {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL QR code */}
        {qr && <img src={qr} alt="Wallet address QR code" width={200} height={200} />}
        <button onClick={() => navigator.clipboard?.writeText(view.address)}>Copy address</button>
      </Card>

      {!wallet.unlocked && view.walletKind === "injected" ? (
        <Card>
          <h2>Connect your wallet to send</h2>
          <p className="muted">
            This account signs with a browser wallet. <Link href="/login">Connect it</Link> to send
            or withdraw.
          </p>
        </Card>
      ) : !wallet.unlocked ? (
        <Card>
          <h2>Unlock to send</h2>
          <input
            type="password"
            inputMode="numeric"
            placeholder="PIN"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
          />
          <button className="primary" disabled={busy} onClick={() => run(() => wallet.unlock(pin))}>
            Unlock
          </button>
        </Card>
      ) : (
        <Card>
          <h2>Send MSTC</h2>
          <label htmlFor="to">To address</label>
          <input
            id="to"
            value={to}
            onChange={(e) => setTo(e.target.value.trim())}
            placeholder="0x…"
          />
          <label htmlFor="amount">Amount (MSTC)</label>
          <input
            id="amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.trim())}
          />
          <button
            className="primary"
            disabled={busy || !isAddress(to) || !(Number(amount) > 0)}
            onClick={() => run(() => tx.sendMstc(sdk().chain, to as Address, parseEther(amount)))}
          >
            Send
          </button>
          {wallet.kind === "injected" ? (
            <div className="row">
              <button onClick={() => wallet.disconnectBrowserWallet()}>
                Disconnect {wallet.browserWalletName}
              </button>
            </div>
          ) : (
            <div className="row">
              <button onClick={() => run(() => wallet.backup())}>Back up wallet</button>
              <button onClick={() => wallet.lock()}>Lock</button>
            </div>
          )}
        </Card>
      )}

      {result && (
        <p className="success">
          Sent. <ExplorerLink href={result.explorerUrl}>View transaction</ExplorerLink>
        </p>
      )}
      <ErrorText error={error} />
      <button
        onClick={() =>
          run(async () => {
            wallet.lock();
            await signOut();
          })
        }
      >
        Sign out
      </button>
    </>
  );
}
