"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import type { Address } from "viem";

import { useCertificate } from "@/hooks/useCertificate";

export default function IssuerAdminPanel() {
  const { address, isConnected } = useAccount();

  const {
    owner,
    isOwnerLoading,
    isOwnerError,
    isDeployed,
    setIssuer,
    isWritePending,
    isConfirming,
    isConfirmed,
    writeError,
  } = useCertificate();

  const [issuerAddress, setIssuerAddress] = useState("");

  const isOwner =
    isConnected && typeof owner === "string" && address?.toLowerCase() === owner.toLowerCase();

  const busy = isWritePending || isConfirming;
  const canSubmit = isOwner && issuerAddress.trim().startsWith("0x") && !busy;

  const handleSetIssuer = (allowed: boolean) => {
    if (!canSubmit) return;
    setIssuer(issuerAddress.trim() as Address, allowed);
  };

  return (
    <div className="card">
      <div className="card-header">
        <h2>Issuer Wallets</h2>
        <p className="hint">
          Owner-only. Grant issuing rights to any wallet — no need to deploy with, or connect as,
          a single hard-coded address. The deployer is an issuer by default.
        </p>
      </div>

      {!isDeployed ? (
        <p className="hint">
          No Certificate deployment found for this network. Run <code>npm run deploy:testnet</code>{" "}
          first.
        </p>
      ) : isOwnerError ? (
        <p className="network-warning">
          Couldn&apos;t read <code>owner()</code> from the deployed contract at this address —
          check the browser console for the underlying error. Common causes: (1)
          <code>packages/shared/src/contracts.ts</code> points at a stale deployment — run{" "}
          <code>npm run deploy:testnet</code> again and reload; (2) the RPC request was blocked by
          CORS or failed outright (a &quot;Failed to fetch&quot; error in the console) — this
          happens if the read is hitting an RPC URL directly instead of the same-origin{" "}
          <code>/api/rpc/*</code> proxy, or if that RPC is unreachable.
        </p>
      ) : isOwnerLoading ? (
        <p className="hint">Loading…</p>
      ) : !isOwner ? (
        <p className="hint">
          Connect the contract owner{owner ? " " : ""}
          {owner ? <code className="mono">{owner.toString()}</code> : null} to manage issuer
          wallets.
        </p>
      ) : (
        <div className="form-stack">
          <div className="field">
            <label htmlFor="issuer-address">Wallet address</label>
            <input
              id="issuer-address"
              type="text"
              value={issuerAddress}
              onChange={(event) => setIssuerAddress(event.target.value)}
              placeholder="0x..."
              className="mono"
            />
          </div>

          <div className="wallet">
            <button type="button" onClick={() => handleSetIssuer(true)} disabled={!canSubmit}>
              {busy ? "Confirming…" : "Grant issuer role"}
            </button>
            <button type="button" onClick={() => handleSetIssuer(false)} disabled={!canSubmit}>
              {busy ? "Confirming…" : "Revoke issuer role"}
            </button>
          </div>

          {isConfirmed && <p className="status-success">Issuer list updated.</p>}
          {writeError && <p className="network-warning">{writeError.message}</p>}
        </div>
      )}
    </div>
  );
}
