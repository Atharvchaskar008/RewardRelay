"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, ErrorText, ExplorerLink, Money, Page, RequireSignIn } from "@/components/ui";
import { useRewardRelay, type AdminDisputeView, type FaultParty } from "@/src/client/sdk";

/** Arbiter desk (ADMIN_UIDS only): open disputes, evidence, rulebook suggestion, resolve. */
export default function AdminPage() {
  return (
    <Page title="Disputes (admin)">
      <RequireSignIn>
        <DisputeDesk />
      </RequireSignIn>
    </Page>
  );
}

function DisputeDesk() {
  const { api } = useRewardRelay();
  const disputes = useQuery({ queryKey: ["admin-disputes"], queryFn: () => api.admin.disputes() });
  if (disputes.isLoading) return <p className="muted">Loading…</p>;
  if (disputes.error) return <ErrorText error={disputes.error} />;
  const items = disputes.data?.items ?? [];
  return (
    <>
      {items.length === 0 && <p className="muted">No open disputes.</p>}
      {items.map((item) => (
        <Dispute key={item.dealId} item={item} />
      ))}
    </>
  );
}

function Dispute({ item }: { item: AdminDisputeView }) {
  const { api } = useRewardRelay();
  const queryClient = useQueryClient();
  const [bps, setBps] = useState(String(item.suggestion.seekerShareBps));
  const [fault, setFault] = useState<FaultParty>(item.suggestion.faultParty);
  const [reason, setReason] = useState(item.suggestion.rule);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function resolve() {
    setBusy(true);
    setError(null);
    try {
      const outcome = await api.admin.resolve(item.dealId, {
        seekerShareBps: Number(bps),
        faultParty: fault,
        reason,
      });
      setResult(outcome.txUrl);
      await queryClient.invalidateQueries({ queryKey: ["admin-disputes"] });
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  async function openFile(path: string) {
    try {
      window.open(URL.createObjectURL(await api.admin.evidenceFile(path)), "_blank", "noopener");
    } catch (caught) {
      setError(caught);
    }
  }

  const opened = item.deal.timeline.find((entry) => entry.event === "DisputeRaised")?.at;
  return (
    <Card>
      <h2>
        #{item.dealId} {item.deal.listing?.title}
      </h2>
      <p>
        Price <Money value={item.deal.price} /> · {item.deal.type} · opened{" "}
        {opened ? new Date(opened).toLocaleString() : "—"}
      </p>
      <p>
        Order proof:{" "}
        {item.proof.submitted
          ? `${item.proof.orderId} (${item.proof.matchesChain ? "matches the chain" : "does NOT match the chain"})`
          : "none"}
        {item.codeRevealedAt && (
          <> · code revealed {new Date(item.codeRevealedAt).toLocaleString()}</>
        )}
      </p>
      <ul>
        {item.evidence.map((entry) => (
          <li key={entry.evidenceHash}>
            <strong>{entry.party}</strong> · {entry.claim} ·{" "}
            {entry.committedOnChain ? "committed on-chain" : "not committed"}: {entry.text}
            {entry.files.map((file) => (
              <button key={file.fileId} onClick={() => openFile(file.path)}>
                Open {file.contentType}
              </button>
            ))}
          </li>
        ))}
      </ul>
      <p className="muted">Suggested: {item.suggestion.rule}</p>
      <label htmlFor={`bps-${item.dealId}`}>Seeker share (basis points; 10000 = full refund)</label>
      <input
        id={`bps-${item.dealId}`}
        inputMode="numeric"
        value={bps}
        onChange={(e) => setBps(e.target.value)}
      />
      <label htmlFor={`fault-${item.dealId}`}>Fault</label>
      <select
        id={`fault-${item.dealId}`}
        value={fault}
        onChange={(e) => setFault(e.target.value as FaultParty)}
      >
        <option value="None">None</option>
        <option value="Sharer">Sharer</option>
        <option value="Seeker">Seeker</option>
      </select>
      <label htmlFor={`reason-${item.dealId}`}>Reason (kept in the audit log)</label>
      <textarea
        id={`reason-${item.dealId}`}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <button className="primary" disabled={busy} onClick={resolve}>
        Resolve on-chain
      </button>
      {result && (
        <p className="success">
          Resolved. <ExplorerLink href={result}>View transaction</ExplorerLink>
        </p>
      )}
      <ErrorText error={error} />
    </Card>
  );
}
