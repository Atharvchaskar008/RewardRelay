"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ErrorText, LoadingCard, Page, RequireSignIn } from "@/components/ui";
import { Button, Card, EmptyState, Field, Pill, inr } from "@/components/ds";
import { useRewardRelay, type AdminDisputeView, type FaultParty } from "@/client/sdk";

/** Arbiter desk (ADMIN_UIDS only): open disputes, evidence, rulebook suggestion, resolve. */
export default function AdminPage() {
  return (
    <Page eyebrow="Admin" title="Disputes">
      <RequireSignIn>
        <DisputeDesk />
      </RequireSignIn>
    </Page>
  );
}

function DisputeDesk() {
  const { api } = useRewardRelay();
  const disputes = useQuery({ queryKey: ["admin-disputes"], queryFn: () => api.admin.disputes() });
  if (disputes.isLoading) return <LoadingCard lines={4} />;
  if (disputes.error) return <ErrorText error={disputes.error} />;
  const items = disputes.data?.items ?? [];
  if (items.length === 0) return <EmptyState title="No open disputes." />;
  return (
    <div className="stack" style={{ gap: 20 }}>
      {items.map((item) => (
        <Dispute key={item.dealId} item={item} />
      ))}
    </div>
  );
}

function Dispute({ item }: { item: AdminDisputeView }) {
  const { api } = useRewardRelay();
  const queryClient = useQueryClient();
  const [percent, setPercent] = useState(String(item.suggestion.seekerShareBps / 100));
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
        seekerShareBps: Math.round(Number(percent) * 100),
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
      <div className="deal-layout" style={{ gridTemplateColumns: "minmax(0, 1fr) 320px" }}>
        <div className="stack" style={{ gap: 16 }}>
          <div className="stack" style={{ gap: 8 }}>
            <span className="label">Deal #{item.dealId}</span>
            <h2 className="title-3">{item.deal.listing?.title ?? `Deal #${item.dealId}`}</h2>
            <div className="row" style={{ gap: 8 }}>
              <Pill>{item.deal.type === "BuyForYou" ? "Buy-for-you" : "Pass-on"}</Pill>
              <Pill tone="danger" dot>
                Disputed
              </Pill>
            </div>
          </div>
          <dl className="kv">
            <dt>Price</dt>
            <dd>
              {inr(item.deal.price.inr)} · {item.deal.price.mstc} MSTC
            </dd>
            <dt>Opened</dt>
            <dd>{opened ? new Date(opened).toLocaleString("en-IN") : "—"}</dd>
            <dt>Order proof</dt>
            <dd>
              {item.proof.submitted
                ? `${item.proof.orderId} · ${item.proof.matchesChain ? "matches chain" : "does NOT match chain"}`
                : "none"}
            </dd>
            {item.codeRevealedAt && (
              <>
                <dt>Code revealed</dt>
                <dd>{new Date(item.codeRevealedAt).toLocaleString("en-IN")}</dd>
              </>
            )}
          </dl>
          <div className="stack" style={{ gap: 8 }}>
            <span className="label">Evidence</span>
            {item.evidence.length === 0 && <p className="faint">None yet.</p>}
            {item.evidence.map((entry) => (
              <div key={entry.evidenceHash} className="card-flat" style={{ padding: 16 }}>
                <div className="row" style={{ gap: 8, marginBottom: 8 }}>
                  <Pill tone={entry.party === "seeker" ? "accent" : "neutral"}>{entry.party}</Pill>
                  <span className="label">{entry.claim.replace(/_/g, " ")}</span>
                  {!entry.committedOnChain && <Pill tone="warning">Not on-chain</Pill>}
                </div>
                <p className="muted" style={{ fontSize: 14 }}>
                  {entry.text}
                </p>
                {entry.files.length > 0 && (
                  <div className="row" style={{ gap: 8, marginTop: 8 }}>
                    {entry.files.map((file) => (
                      <Button
                        key={file.fileId}
                        variant="outline"
                        size="sm"
                        onClick={() => openFile(file.path)}
                      >
                        Open {file.contentType.split("/")[1] ?? "file"}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="stack" style={{ gap: 16 }}>
          <span className="label">Ruling</span>
          <p className="alert alert-accent" style={{ fontSize: 13 }}>
            Suggested: {item.suggestion.rule}
          </p>
          <Field label="Buyer gets (%)" htmlFor={`pct-${item.dealId}`} hint="100 = full refund">
            <input
              id={`pct-${item.dealId}`}
              className="input input-mono"
              inputMode="decimal"
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
            />
          </Field>
          <Field label="At fault" htmlFor={`fault-${item.dealId}`}>
            <select
              id={`fault-${item.dealId}`}
              className="select"
              value={fault}
              onChange={(e) => setFault(e.target.value as FaultParty)}
            >
              <option value="None">Nobody</option>
              <option value="Sharer">Sharer</option>
              <option value="Seeker">Buyer</option>
            </select>
          </Field>
          <Field label="Reason" htmlFor={`reason-${item.dealId}`} hint="Kept in the audit log">
            <textarea
              id={`reason-${item.dealId}`}
              className="textarea"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <Button block loading={busy} onClick={resolve}>
            Resolve on-chain
          </Button>
          {result && (
            <p className="alert alert-success">
              Resolved.&nbsp;
              <a className="link" href={result} target="_blank" rel="noreferrer noopener">
                View
              </a>
            </p>
          )}
          <ErrorText error={error} />
        </div>
      </div>
    </Card>
  );
}
