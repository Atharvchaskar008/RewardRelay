"use client";

import { useState } from "react";

const BACKEND_URL = process.env.NEXT_PUBLIC_CERT_BACKEND_URL || "http://localhost:4100";

const PLACEHOLDER = `0xabc...,Jane Doe,B.Sc. Computer Science,2026-05-01
0xdef...,John Roe,B.Sc. Computer Science,2026-05-01`;

type Row = { to: string; holderName: string; credential: string; issuedOn: string };
type BatchResponse = { txHash: string; tokenIds: string[] };

function parseRows(input: string): { rows: Row[]; errors: string[] } {
  const rows: Row[] = [];
  const errors: string[] = [];

  input
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line, index) => {
      const parts = line.split(",").map((part) => part.trim());
      const [to, holderName, credential, issuedOn] = parts;

      if (!to?.startsWith("0x") || !holderName || !credential) {
        errors.push(`Line ${index + 1}: expected "address,holderName,credential,issuedOn"`);
        return;
      }

      rows.push({
        to,
        holderName,
        credential,
        issuedOn: issuedOn || new Date().toISOString().slice(0, 10),
      });
    });

  return { rows, errors };
}

export default function AutoBatchIssuePanel() {
  const [input, setInput] = useState("");
  const { rows, errors } = parseRows(input);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<BatchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = rows.length > 0 && errors.length === 0 && !isSubmitting;

  const handleBatchIssue = async () => {
    if (!canSubmit) return;

    setIsSubmitting(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch(`${BACKEND_URL}/api/batch-issue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });

      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || `Request failed (${response.status})`);

      setResult(body as BatchResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Batch issue failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <h2>Automated Batch Issuance</h2>
        <p className="hint">
          Same as Batch Issue, but signed and sent by the backend&apos;s own wallet — no browser
          wallet needed.
        </p>
      </div>

      <div className="form-stack">
        <div className="field">
          <label htmlFor="auto-batch-input">Recipients</label>
          <textarea
            id="auto-batch-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={PLACEHOLDER}
            rows={5}
            className="mono"
          />
          <p className="hint">{rows.length} valid row(s) parsed.</p>
        </div>

        <div className="wallet">
          <button type="button" onClick={handleBatchIssue} disabled={!canSubmit}>
            {isSubmitting
              ? "Issuing…"
              : `Issue ${rows.length || ""} certificate${rows.length === 1 ? "" : "s"} via backend`}
          </button>
        </div>

        {errors.length > 0 && (
          <p className="status-error">
            {errors[0]}
            {errors.length > 1 ? ` (+${errors.length - 1} more)` : ""}
          </p>
        )}
        {result && (
          <p className="status-success">
            Issued token IDs {result.tokenIds.join(", ")}.{" "}
            <span className="mono break">{result.txHash}</span>
          </p>
        )}
        {error && <p className="network-warning">{error}</p>}
      </div>
    </div>
  );
}
