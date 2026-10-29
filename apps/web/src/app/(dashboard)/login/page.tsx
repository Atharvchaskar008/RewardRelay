"use client";

import { useState, type ReactNode } from "react";
import type { ConfirmationResult } from "firebase/auth";
import { ErrorText, Page } from "@/components/ui";
import {
  Avatar,
  Button,
  Card,
  Field,
  IconChevronRight,
  Stat,
  inr,
  shortAddress,
} from "@/components/ds";
import { useBrowserWallets, useMe, useWallet, type InjectedWallet } from "@/client/sdk";
import { firebaseConfigured } from "@/client/config";
import { sendOtp } from "@/client/firebase";
import { toE164 } from "@/client/phone";
import { useSession } from "@/app/providers";

/**
 * Phone OTP (Firebase) → a wallet linked to the phone: the PIN-protected device wallet, or a browser
 * wallet (BridgeKey, MetaMask) → Trust Badge and test MSTC.
 */

function AuthCard({
  step,
  title,
  children,
}: {
  step?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <Page narrow>
      <div className="auth">
        <Card className="auth-card">
          <div className="stack" style={{ gap: 8 }}>
            {step && <span className="label">{step}</span>}
            <h1 className="title-2">{title}</h1>
          </div>
          {children}
        </Card>
      </div>
    </Page>
  );
}

export default function LoginPage() {
  const { ready, user } = useSession();
  const [phone, setPhone] = useState("");
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
      <AuthCard title="Sign in">
        <p className="alert alert-danger">Phone sign-in is not configured on this site yet.</p>
      </AuthCard>
    );
  }
  if (!ready) {
    return (
      <AuthCard title="Sign in">
        <p className="muted">Loading…</p>
      </AuthCard>
    );
  }

  if (!user) {
    return (
      <>
        {!confirmation ? (
          <AuthCard step="Step 1 of 3" title="Sign in">
            <form
              className="stack"
              style={{ gap: 16 }}
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  const number = toE164(phone.startsWith("+") ? phone : `+91${phone}`);
                  setConfirmation(await sendOtp(number, "recaptcha"));
                  setSentTo(number);
                });
              }}
            >
              <Field label="Mobile number" htmlFor="phone">
                <div className="prefix-input">
                  <span>+91</span>
                  <input
                    id="phone"
                    className="input input-mono"
                    inputMode="tel"
                    autoComplete="tel-national"
                    placeholder="98765 43210"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
              </Field>
              <Button type="submit" block size="lg" loading={busy}>
                Send code
              </Button>
            </form>
            <ErrorText error={error} />
          </AuthCard>
        ) : (
          <AuthCard step="Step 2 of 3" title="Enter the code">
            <form
              className="stack"
              style={{ gap: 16 }}
              onSubmit={(event) => {
                event.preventDefault();
                void run(() => confirmation.confirm(code.replace(/\D/g, "")));
              }}
            >
              <Field label={`Sent to ${sentTo}`} htmlFor="code">
                <input
                  id="code"
                  className="input otp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="••••••"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </Field>
              <Button type="submit" block size="lg" loading={busy}>
                Verify
              </Button>
              <Button
                type="button"
                variant="ghost"
                block
                disabled={busy}
                onClick={() => {
                  setConfirmation(null);
                  setCode("");
                  setError(null);
                }}
              >
                Change number
              </Button>
            </form>
            <ErrorText error={error} />
          </AuthCard>
        )}
        <div id="recaptcha" />
      </>
    );
  }
  return <WalletStep />;
}

function WalletStep() {
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

  if (!wallet.ready || me.isLoading) {
    return (
      <AuthCard title="Your wallet">
        <p className="muted">Loading…</p>
      </AuthCard>
    );
  }

  if (me.data && wallet.unlocked) {
    return (
      <AuthCard title="You're in">
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
        <div className="stack" style={{ gap: 8 }}>
          <Button href="/explore" block size="lg">
            Explore offers
          </Button>
          <Button href="/dashboard" variant="outline" block>
            Go to overview
          </Button>
          <Button variant="ghost" block onClick={() => wallet.disconnectBrowserWallet()}>
            Disconnect wallet
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard step="Step 3 of 3" title="Connect your wallet">
      <p className="muted">
        Connect your BridgeKey or MetaMask wallet to sign transactions securely on MST Blockchain.
      </p>
      <BrowserWalletPicker
        busy={busy}
        onPick={(picked) => runConnect(() => wallet.connectBrowserWallet(picked, me.data?.address))}
      />
      <ErrorText error={error} />
    </AuthCard>
  );
}

/** The browser wallets found in this browser, one row each. */
function BrowserWalletPicker(props: { busy: boolean; onPick: (wallet: InjectedWallet) => void }) {
  const wallets = useBrowserWallets();
  if (wallets === null) return <p className="faint">Looking for wallets…</p>;
  if (wallets.length === 0) {
    return <p className="faint">No wallet found. Install BridgeKey or MetaMask, then reload.</p>;
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      {wallets.map((candidate) => (
        <button
          key={candidate.info.uuid}
          type="button"
          className="option"
          disabled={props.busy}
          onClick={() => props.onPick(candidate)}
        >
          {candidate.info.icon ? (
            // eslint-disable-next-line @next/next/no-img-element -- wallet icons are data: URIs
            <img src={candidate.info.icon} alt="" width={24} height={24} />
          ) : (
            <Avatar size={24} />
          )}
          {candidate.info.name}
          <IconChevronRight />
        </button>
      ))}
    </div>
  );
}
