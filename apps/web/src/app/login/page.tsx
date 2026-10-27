"use client";

import Link from "next/link";
import { useState } from "react";
import type { ConfirmationResult } from "firebase/auth";
import { Card, ErrorText, Money, Page } from "@/components/ui";
import { useMe, useWallet, validatePin } from "@/client/sdk";
import { firebaseConfigured } from "@/client/config";
import { sendOtp } from "@/client/firebase";
import { useSession } from "@/app/providers";

/** Phone OTP (Firebase) → PIN → embedded wallet linked to the phone, Trust Badge and test MSTC. */
export default function LoginPage() {
  const { ready, user } = useSession();
  const [phone, setPhone] = useState("+91");
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
                run(async () =>
                  setConfirmation(await sendOtp(phone.replace(/\s+/g, ""), "recaptcha")),
                )
              }
            >
              Send code
            </button>
          </Card>
        ) : (
          <Card>
            <label htmlFor="code">6-digit code sent to {phone}</label>
            <input
              id="code"
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <button
              className="primary"
              disabled={busy}
              onClick={() => run(() => confirmation.confirm(code))}
            >
              Verify
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
    setBusy(true);
    setError(null);
    try {
      validatePin(pin);
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
        {busy && <p className="muted">Setting up your Trust Badge and test MSTC…</p>}
      </Card>
      <ErrorText error={error} />
    </Page>
  );
}
