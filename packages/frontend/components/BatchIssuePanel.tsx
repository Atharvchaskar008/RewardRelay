"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import type { Address } from "viem";

import { useCertificate } from "@/hooks/useCertificate";
import { hashCertificate } from "@/lib/certificateHash";

const PLACEHOLDER = `0xabc...,Jane Doe,B.Sc. Computer Science,2026-05-01
0xdef...,John Roe,B.Sc. Computer Science,2026-05-01`;

type Row = { address: Address; holderName: string; credential: string; issuedOn: string };

function parseRows(input: string): { rows: Row[]; errors: string[] } {
  const rows: Row[] = [];
  const errors: string[] = [];

  input
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line, index) => {
      const parts = line.split(",").map((part) => part.trim());
      const [address, holderName, credential, issuedOn] = parts;

      if (!address?.startsWith("0x") || !holderName || !credential) {
        errors.push(`Line ${index + 1}: expected "address,holderName,credential,issuedOn"`);
        return;
      }

      rows.push({
        address: address as Address,
        holderName,
        credential,
        issuedOn: issuedOn || new Date().toISOString().slice(0, 10),
      });
    });

  return { rows, errors };
}

export default function BatchIssuePanel() {
  const { isConnected } = useAccount();
  const {
    batchIssue,
    isDeployed,
    isConnectedWalletIssuer,
    isIssuerLoading,
    isIssuerError,
    isWritePending,
    isConfirming,
    isConfirmed,
    writeError,
  } = useCertificate();

  const [input, setInput] = useState("");
  const { rows, errors } = parseRows(input);

  const handleBatchIssue = () => {
    if (!isConnected || !isConnectedWalletIssuer || rows.length === 0 || errors.length > 0) return;

    const to = rows.map((row) => row.address);
    const certHashes = rows.map((row) => hashCertificate(row));
    const tokenURIs = rows.map((row) => {
      const metadata = {
        name: row.credential,
        description: `Issued to ${row.holderName} on ${row.issuedOn}.`,
        ...row,
      };
      return `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(metadata))}`;
    });

    batchIssue(to, certHashes, tokenURIs);
  };

  const busy = isWritePending || isConfirming;

  return (
    <div className="card">
      <div className="card-header">
        <h2>Batch Issue</h2>
        <p className="hint">
          One certificate per line: <code>address,holderName,credential,issuedOn</code> — issues
          all of them in a single transaction.
        </p>
      </div>

      {!isDeployed ? (
        <p className="hint">
          No Certificate deployment found for this network. Run <code>npm run deploy:testnet</code>{" "}
          first.
        </p>
      ) : (
        <div className="form-stack">
          <div className="field">
            <label htmlFor="batch-input">Recipients</label>
            <textarea
              id="batch-input"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={PLACEHOLDER}
              rows={5}
              className="mono"
            />
            <p className="hint">{rows.length} valid row(s) parsed.</p>
          </div>

          <div className="wallet">
            <button
              type="button"
              onClick={handleBatchIssue}
              disabled={
                !isConnected || !isConnectedWalletIssuer || rows.length === 0 || errors.length > 0 || busy
              }
            >
              {isWritePending
                ? "Confirm in wallet…"
                : isConfirming
                  ? "Issuing…"
                  : `Issue ${rows.length || ""} certificate${rows.length === 1 ? "" : "s"}`}
            </button>
          </div>

          {!isConnected && <p className="hint">Connect your wallet first.</p>}
          {isConnected && isIssuerError && (
            <p className="network-warning">
              Couldn&apos;t read issuer status from the deployed contract — check the browser
              console for the underlying error. Common causes: a stale deployment (run{" "}
              <code>npm run deploy:testnet</code> and reload), or the RPC request was blocked by
              CORS / failed outright (a &quot;Failed to fetch&quot; error in the console).
            </p>
          )}
          {isConnected && !isIssuerLoading && !isIssuerError && isConnectedWalletIssuer === false && (
            <p className="network-warning">
              Connected wallet isn&apos;t an authorized issuer. Ask the contract owner to grant it
              issuer rights in the Issuer Wallets panel below.
            </p>
          )}
          {errors.length > 0 && (
            <p className="status-error">{errors[0]}{errors.length > 1 ? ` (+${errors.length - 1} more)` : ""}</p>
          )}
          {isConfirmed && <p className="status-success">Batch issued successfully.</p>}
          {writeError && <p className="network-warning">{writeError.message}</p>}
        </div>
      )}
    </div>
  );
}
