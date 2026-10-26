"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import type { Address } from "viem";

import { useCertificate } from "@/hooks/useCertificate";
import { hashCertificate } from "@/lib/certificateHash";

function buildTokenURI(holderName: string, credential: string, issuedOn: string) {
  const metadata = {
    name: credential,
    description: `Issued to ${holderName} on ${issuedOn}.`,
    holderName,
    credential,
    issuedOn,
  };
  return `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(metadata))}`;
}

export default function IssuePanel() {
  const { isConnected } = useAccount();

  const {
    issue,
    isDeployed,
    isConnectedWalletIssuer,
    isIssuerLoading,
    isIssuerError,
    isWritePending,
    isConfirming,
    isConfirmed,
    writeError,
    refetchTotalSupply,
  } = useCertificate();

  const [recipient, setRecipient] = useState("");
  const [holderName, setHolderName] = useState("");
  const [credential, setCredential] = useState("");
  const [issuedOn, setIssuedOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [issuedTokenId, setIssuedTokenId] = useState<bigint | null>(null);

  const canSubmit =
    isConnected &&
    isConnectedWalletIssuer === true &&
    recipient.trim() &&
    holderName.trim() &&
    credential.trim();

  const handleIssue = async () => {
    if (!canSubmit) return;

    const tokenURI = buildTokenURI(holderName.trim(), credential.trim(), issuedOn);
    const certHash = hashCertificate({ holderName, credential, issuedOn });

    issue(recipient.trim() as Address, certHash, tokenURI);
  };

  useEffect(() => {
    if (!isConfirmed || issuedTokenId !== null) return;

    let cancelled = false;
    refetchTotalSupply().then(({ data }) => {
      if (!cancelled && typeof data === "bigint") setIssuedTokenId(data);
    });

    return () => {
      cancelled = true;
    };
  }, [isConfirmed, issuedTokenId, refetchTotalSupply]);

  const busy = isWritePending || isConfirming;

  return (
    <div className="card">
      <div className="card-header">
        <h2>Issue Certificate</h2>
        <p className="hint">
          Fills a soulbound certificate NFT with a keccak256 fingerprint of the credential data —
          any later edit produces a different hash and fails verification.
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
            <label htmlFor="cert-recipient">Recipient address</label>
            <input
              id="cert-recipient"
              type="text"
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
              placeholder="0x..."
              className="mono"
            />
          </div>

          <div className="field">
            <label htmlFor="cert-holder">Holder name</label>
            <input
              id="cert-holder"
              type="text"
              value={holderName}
              onChange={(event) => setHolderName(event.target.value)}
              placeholder="Jane Doe"
            />
          </div>

          <div className="field">
            <label htmlFor="cert-credential">Credential</label>
            <input
              id="cert-credential"
              type="text"
              value={credential}
              onChange={(event) => setCredential(event.target.value)}
              placeholder="B.Sc. Computer Science"
            />
          </div>

          <div className="field">
            <label htmlFor="cert-date">Issued on</label>
            <input
              id="cert-date"
              type="date"
              value={issuedOn}
              onChange={(event) => setIssuedOn(event.target.value)}
            />
          </div>

          <div className="wallet">
            <button
              type="button"
              onClick={() => {
                setIssuedTokenId(null);
                handleIssue();
              }}
              disabled={!canSubmit || busy}
            >
              {isWritePending ? "Confirm in wallet…" : isConfirming ? "Issuing…" : "Issue certificate"}
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
          {isConfirmed && (
            <p className="status-success">
              Certificate issued
              {issuedTokenId !== null ? ` — token ID ${issuedTokenId.toString()}.` : "."}
            </p>
          )}
          {writeError && <p className="network-warning">{writeError.message}</p>}
        </div>
      )}
    </div>
  );
}
