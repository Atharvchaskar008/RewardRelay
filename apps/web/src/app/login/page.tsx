"use client";

import Link from "next/link";
import { useState } from "react";
import type { ConfirmationResult } from "firebase/auth";
import { Card, ErrorText, Money, Page } from "@/components/ui";
import {
  useBrowserWallets,
  useMe,
  useWallet,
  validatePin,
  type InjectedWallet,
} from "@/client/sdk";
import { coinLabel, firebaseConfigured } from "@/client/config";
import { sendOtp } from "@/client/firebase";
import { toE164 } from "@/client/phone";
import { useSession } from "@/app/providers";

/**
 * Phone OTP (Firebase) → a wallet linked to the phone: the PIN-protected device wallet, or a browser
 * wallet (BridgeKey, MetaMask) → Trust Badge and test MSTC.
 */
export default function LoginPage() {
  const { ready, user } = useSession();
  const [phone, setPhone] = useState("+91");
  const [sentTo, setSentTo] = useState("");
  const [code, setCode] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function run(work: () => Promise<unknown>) {
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

  if (!firebaseConfigured) {
    return (
      <Page title="Sign in">
        <p className="error">Phone sign-in is not configured yet (no Firebase web app settings).</p>
      </Page>
    );
  }
  if (!ready) return <Page title="Sign in">Loading…</Page>;

  if (!user) {
    return (
      <Page title="Sign in">
        {!confirmation ? (
          <Card>
            <label htmlFor="phone">Mobile number</label>
            <input
              id="phone"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const number = toE164(phone);
                  setConfirmation(await sendOtp(number, "recaptcha"));
                  setSentTo(number);
                })
              }
            >
              Send code
            </button>
          </Card>
        ) : (
          <Card>
            <label htmlFor="code">6-digit code sent to {sentTo}</label>
            <input
              id="code"
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <button
              className="primary"
              disabled={busy}
              onClick={() => run(() => confirmation.confirm(code.replace(/\D/g, "")))}
            >
              Verify
            </button>
            <button
              disabled={busy}
              onClick={() => {
                setConfirmation(null);
                setCode("");
                setError(null);
              }}
            >
              Change number
            </button>
          </Card>
        )}
        <div id="recaptcha" />
        <ErrorText error={error} />
      </Page>
    );
  }
  return <PinStep />;
}

function PinStep() {
  const wallet = useWallet();
  const me = useMe();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function run(work: () => Promise<unknown>) {
    return runWithoutPin(async () => {
      validatePin(pin);
      await work();
    });
  }

  async function runWithoutPin(work: () => Promise<unknown>) {
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

  if (!wallet.ready || me.isLoading) return <Page title="Your wallet">Loading…</Page>;

  if (me.data && wallet.unlocked) {
    return (
      <Page title="You are in">
        <Card>
          <p>
            Wallet <code>{me.data.address}</code>
            {wallet.kind === "injected" && <> · signing with {wallet.browserWalletName}</>}
          </p>
          <p>
            Trust Badge: <strong>{me.data.badge.tierName}</strong> · deal limit{" "}
            <Money value={me.data.badge.maxDealValue} />
          </p>
          <p>
            Balance{" "}
            <Money
              value={{
                wei: me.data.balanceWei,
                mstc: me.data.balanceMstc,
                inr: me.data.balanceInr,
              }}
            />
          </p>
        </Card>
        <Link href="/explore">Browse offers</Link>
        {wallet.kind === "injected" && (
          <button onClick={() => wallet.disconnectBrowserWallet()}>Disconnect wallet</button>
        )}
      </Page>
    );
  }

  // An account linked to a browser wallet signs with that wallet: there is no PIN backup.
  if (me.data?.walletKind === "injected") {
    return (
      <Page title="Connect your wallet">
        <Card>
          <p className="muted">
            Your account is linked to a browser wallet. Connect it with the account{" "}
            <code>{me.data.address}</code>.
          </p>
          <BrowserWalletPicker
            busy={busy}
            onPick={(picked) =>
              runWithoutPin(() => wallet.connectBrowserWallet(picked, me.data?.address))
            }
          />
        </Card>
        <ErrorText error={error} />
      </Page>
    );
  }

  const linkedElsewhere = me.data && !wallet.exists;
  return (
    <Page title={wallet.exists ? "Unlock your wallet" : "Set your PIN"}>
      <Card>
        <p className="muted">
          Your wallet key is created on this device and stored only encrypted with this PIN (6-12
          digits). We cannot recover the PIN.
        </p>
        <label htmlFor="pin">PIN</label>
        <input
          id="pin"
          type="password"
          inputMode="numeric"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
        />
        {wallet.exists ? (
          <button
            className="primary"
            disabled={busy}
            onClick={() => run(() => (me.data ? wallet.unlock(pin) : wallet.create(pin)))}
          >
            Unlock
          </button>
        ) : linkedElsewhere ? (
          <button
            className="primary"
            disabled={busy}
            onClick={() => run(() => wallet.restore(pin))}
          >
            Restore my wallet from backup
          </button>
        ) : (
          <button className="primary" disabled={busy} onClick={() => run(() => wallet.create(pin))}>
            Create wallet
          </button>
        )}
        {busy && <p className="muted">Setting up your Trust Badge and {coinLabel} for fees…</p>}
      </Card>
      {!me.data && (
        <Card>
          <p>
            <strong>Already use a crypto wallet?</strong> Link BridgeKey or MetaMask instead of a
            PIN wallet: you sign once to prove it is yours, and approve every deal in your wallet.
          </p>
          <BrowserWalletPicker
            busy={busy}
            onPick={(picked) => runWithoutPin(() => wallet.connectBrowserWallet(picked))}
          />
        </Card>
      )}
      <ErrorText error={error} />
    </Page>
  );
}

/** The browser wallets found in this browser, one button each. */
function BrowserWalletPicker(props: { busy: boolean; onPick: (wallet: InjectedWallet) => void }) {
  const wallets = useBrowserWallets();
  if (wallets === null) return <p className="muted">Looking for wallets…</p>;
  if (wallets.length === 0) {
    return (
      <p className="muted">
        No browser wallet found. Install the BridgeKey or MetaMask browser extension, then reload
        this page.
      </p>
    );
  }
  return (
    <div className="row">
      {wallets.map((candidate) => (
        <button
          key={candidate.info.uuid}
          disabled={props.busy}
          onClick={() => props.onPick(candidate)}
        >
          {candidate.info.icon && (
            // eslint-disable-next-line @next/next/no-img-element -- wallet icons are data: URIs
            <img src={candidate.info.icon} alt="" width={20} height={20} />
          )}{" "}
          {candidate.info.name}
        </button>
      ))}
    </div>
  );
}
