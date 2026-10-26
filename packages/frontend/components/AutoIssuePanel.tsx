"use client";

import { useState } from "react";

const BACKEND_URL = process.env.NEXT_PUBLIC_CERT_BACKEND_URL || "http://localhost:4100";

type IssueResponse = { txHash: string; tokenId: string | null };

export default function AutoIssuePanel() {
  const [recipient, setRecipient] = useState("");
  const [holderName, setHolderName] = useState("");
  const [credential, setCredential] = useState("");
  const [issuedOn, setIssuedOn] = useState(() => new Date().toISOString().slice(0, 10));

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<IssueResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    recipient.trim().startsWith("0x") && holderName.trim() && credential.trim() && !isSubmitting;

  const handleIssue = async () => {
    if (!canSubmit) return;

    setIsSubmitting(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch(`${BACKEND_URL}/api/issue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: recipient.trim(),
          holderName: holderName.trim(),
          credential: credential.trim(),
          issuedOn,
        }),
      });

      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || `Request failed (${response.status})`);

      setResult(body as IssueResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Issue failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <h2>Automated Issuance</h2>
        <p className="hint">
          Issues instantly through the backend&apos;s own wallet — no browser wallet connection
          needed. Good for triggering issuance from a webhook or another system. Requires{" "}
          <code>ISSUER_PRIVATE_KEY</code> set in <code>.env.local</code> and that wallet granted
          issuer rights.
        </p>
      </div>

      <div className="form-stack">
        <div className="field">
          <label htmlFor="auto-recipient">Recipient address</label>
          <input
            id="auto-recipient"
            type="text"
            value={recipient}
            onChange={(event) => setRecipient(event.target.value)}
            placeholder="0x..."
            className="mono"
          />
        </div>

        <div className="field">
          <label htmlFor="auto-holder">Holder name</label>
          <input
            id="auto-holder"
            type="text"
            value={holderName}
            onChange={(event) => setHolderName(event.target.value)}
            placeholder="Jane Doe"
          />
        </div>

        <div className="field">
          <label htmlFor="auto-credential">Credential</label>
          <input
            id="auto-credential"
            type="text"
            value={credential}
            onChange={(event) => setCredential(event.target.value)}
            placeholder="B.Sc. Computer Science"
          />
        </div>

        <div className="field">
          <label htmlFor="auto-date">Issued on</label>
          <input
            id="auto-date"
            type="date"
            value={issuedOn}
            onChange={(event) => setIssuedOn(event.target.value)}
          />
        </div>

        <div className="wallet">
          <button type="button" onClick={handleIssue} disabled={!canSubmit}>
            {isSubmitting ? "Issuing…" : "Issue via backend"}
          </button>
        </div>

        {result && (
          <p className="status-success">
            Certificate issued{result.tokenId ? ` — token ID ${result.tokenId}` : ""}.{" "}
            <span className="mono break">{result.txHash}</span>
          </p>
        )}
        {error && <p className="network-warning">{error}</p>}
      </div>
    </div>
  );
}
