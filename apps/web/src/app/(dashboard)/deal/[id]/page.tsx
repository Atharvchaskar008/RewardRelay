"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Fragment, useEffect, useState, type CSSProperties } from "react";
import { loadSavedDelivery, saveDelivery } from "@/client/savedDelivery";
import { ErrorText, LoadingCard, Page, StatusPill } from "@/components/ui";
import {
  Avatar,
  Button,
  Card,
  CopyButton,
  Field,
  IconExternal,
  IconShield,
  Pill,
  Stepper,
  inr,
  shortAddress,
} from "@/components/ds";
import {
  useDeal,
  useDealAction,
  useRewardRelay,
  useSendDeliveryDetails,
  useWallet,
  type DealAction,
  type DealActionInput,
  type DealView,
  type DeliveryDetails,
  type EvidenceClaim,
  type ProofView,
  type RevealedCode,
} from "@/client/sdk";

/** The deal room: one primary button from nextAction, secondary actions, private-data panels. */
export default function DealPage() {
  const { id } = useParams<{ id: string }>();
  const deal = useDeal(id);
  if (deal.isLoading) {
    return (
      <Page eyebrow={`Deal #${id}`} title="Loading…">
        <LoadingCard lines={4} />
      </Page>
    );
  }
  if (!deal.data) {
    return (
      <Page eyebrow={`Deal #${id}`} title="Deal not found">
        <ErrorText error={deal.error} />
      </Page>
    );
  }
  return <DealRoom deal={deal.data} />;
}

const PRIMARY_LABELS: Partial<Record<DealAction, string>> = {
  PAY: "Pay",
  MARK_DELIVERED: "Mark delivered",
  CONFIRM: "Confirm receipt",
  RELEASE_AVAILABLE: "Release payment",
  CLAIM_REFUND: "Claim refund",
};

const SECONDARY_LABELS: Record<string, string> = {
  CANCEL: "Cancel listing",
  RAISE_DISPUTE: "Report a problem",
  ADD_EVIDENCE: "Add evidence",
  CONFIRM: "Withdraw dispute",
  DEFAULT_RESOLVE: "Apply 50/50 ruling",
};

const REASONS: Record<string, string> = {
  SIGN_IN: "Sign in to pay for this deal.",
  NO_WALLET: "Finish signing up to get a wallet.",
  NO_BADGE: "You need a Trust Badge to pay.",
  OVER_LIMIT: "This deal is above your Trust Badge limit.",
  PAUSED: "New deals are paused right now.",
  EVENT_STARTED: "The event has already started.",
  AWAITING_SEEKER: "Waiting for a buyer.",
  AWAITING_DELIVERY: "Waiting for the Sharer to deliver.",
  IN_CHECK_WINDOW: "The buyer is checking the delivery.",
  AWAITING_ARBITER: "The dispute is with the arbiter.",
  DELIVERY_WINDOW_CLOSED: "The delivery window has closed.",
  NOT_A_PARTY: "You are not part of this deal.",
  FINISHED: "This deal is finished.",
};

const CLAIMS: { value: EvidenceClaim; label: string }[] = [
  { value: "not_delivered", label: "Not delivered" },
  { value: "not_as_described", label: "Not as described" },
  { value: "booking_cancelled", label: "Booking was cancelled" },
  { value: "code_invalid", label: "The code does not work" },
  { value: "delivered_as_agreed", label: "Delivered as agreed" },
  { value: "other", label: "Something else" },
];

const fmt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-IN", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

const STEP_INDEX: Record<string, number> = {
  Listed: 0,
  Locked: 1,
  Delivered: 2,
  Disputed: 2,
  Completed: 4,
  Resolved: 4,
  Refunded: 4,
  Cancelled: 4,
};

function progress(deal: DealView) {
  const labels = ["Listed", "Paid", "Delivered", "Settled"];
  const at = STEP_INDEX[deal.status] ?? 0;
  return labels.map((label, index) => ({
    label,
    state: (index < at ? "done" : index === at ? "current" : "todo") as "done" | "current" | "todo",
  }));
}

function DealRoom({ deal }: { deal: DealView }) {
  const wallet = useWallet();
  const action = useDealAction(deal.id);
  const [details, setDetails] = useDeliveryDetails();
  const [orderId, setOrderId] = useState("");
  const [notes, setNotes] = useState("");
  const [invoice, setInvoice] = useState<File | undefined>();
  const [claim, setClaim] = useState<EvidenceClaim>("not_as_described");
  const [evidenceText, setEvidenceText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [lastTx, setLastTx] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [openForm, setOpenForm] = useState<DealAction | null>(null);

  // The chain has the last word: when the deal moved on, an earlier error no longer applies.
  useEffect(() => setError(null), [deal.status]);

  async function run(name: DealAction, input?: DealActionInput) {
    setError(null);
    try {
      const result = await action.mutateAsync({ action: name, input });
      setLastTx(result.tx?.explorerUrl ?? null);
      setOpenForm(null);
    } catch (caught) {
      setError(caught);
    }
  }

  const evidence = { claim, text: evidenceText, files };
  const needsBrowserWallet = !wallet.unlocked;
  const actionable = deal.nextAction !== "WAIT" && deal.nextAction !== "NONE";
  const anyAction = actionable || deal.secondaryActions.length > 0;
  const terms = Object.entries(deal.listing?.terms ?? {});
  const faceValue = deal.listing?.faceValueInr ?? 0;

  return (
    <main className="page">
      <header className="page-head">
        <div className="stack" style={{ gap: 12 }}>
          <Link href="/explore" className="label">
            ← Offers · Deal #{deal.id}
          </Link>
          <h1 className="title-2" style={{ maxWidth: "22ch" }}>
            {deal.listing?.title ?? `Deal #${deal.id}`}
          </h1>
          <div className="row" style={{ gap: 8 }}>
            <StatusPill status={deal.status} label={deal.statusLabel} />
            <Pill>{deal.type === "BuyForYou" ? "Buy-for-you" : "Pass-on"}</Pill>
            <Pill>{deal.categoryLabel}</Pill>
            {deal.role !== "visitor" && <Pill tone="accent">You · {deal.role}</Pill>}
          </div>
        </div>
      </header>

      <div className="deal-layout">
        <div className="stack" style={{ gap: 20 }}>
          <Card>
            <div className="card-head">
              <span className="label">Progress</span>
            </div>
            <Stepper steps={progress(deal)} />
            <dl className="kv" style={{ marginTop: 24 }}>
              {deal.deadlines.deliverBy && (
                <>
                  <dt>Deliver by</dt>
                  <dd>{fmt(deal.deadlines.deliverBy)}</dd>
                </>
              )}
              {deal.deadlines.releaseAt && (
                <>
                  <dt>Release from</dt>
                  <dd>{fmt(deal.deadlines.releaseAt)}</dd>
                </>
              )}
              {deal.deadlines.eventTime && (
                <>
                  <dt>Event</dt>
                  <dd>{fmt(deal.deadlines.eventTime)}</dd>
                </>
              )}
              {deal.deadlines.evidenceUntil && (
                <>
                  <dt>Evidence until</dt>
                  <dd>{fmt(deal.deadlines.evidenceUntil)}</dd>
                </>
              )}
              {deal.deadlines.defaultRulingAt && (
                <>
                  <dt>Default ruling</dt>
                  <dd>{fmt(deal.deadlines.defaultRulingAt)}</dd>
                </>
              )}
            </dl>
          </Card>

          <Card>
            <div className="card-head">
              <span className="label">Details</span>
            </div>
            {deal.listing?.description && (
              <p className="muted" style={{ marginBottom: 20 }}>
                {deal.listing.description}
              </p>
            )}
            <dl className="kv">
              <dt>Price</dt>
              <dd>
                {inr(deal.price.inr)} <span className="faint">· {deal.price.mstc} MSTC</span>
              </dd>
              {faceValue > 0 && (
                <>
                  <dt>Worth</dt>
                  <dd>{inr(faceValue)}</dd>
                </>
              )}
              <dt>Sharer deposit</dt>
              <dd>{deal.deposits.sharer.mstc} MSTC</dd>
              <dt>Buyer deposit</dt>
              <dd>{deal.deposits.seeker.mstc} MSTC</dd>
              <dt>Fee</dt>
              <dd>{deal.feeBps / 100}%</dd>
              {terms.map(([key, value]) => (
                <Fragment key={key}>
                  <dt>{key.replace(/([A-Z])/g, " $1").toLowerCase()}</dt>
                  <dd>{Array.isArray(value) ? value.join(", ") : String(value)}</dd>
                </Fragment>
              ))}
            </dl>
          </Card>

          <Card>
            <div className="card-head">
              <span className="label">People</span>
            </div>
            <div className="parties">
              <Party label="Sharer" address={deal.sharer} you={deal.role === "sharer"} />
              {deal.seeker ? (
                <Party label="Buyer" address={deal.seeker} you={deal.role === "seeker"} />
              ) : (
                <div className="party">
                  <Avatar size={40} />
                  <span className="faint" style={{ fontSize: 14 }}>
                    No buyer yet
                  </span>
                </div>
              )}
            </div>
            {deal.counterpartTrust && (
              <p className="faint" style={{ fontSize: 13, marginTop: 16 }}>
                Other side: {deal.counterpartTrust.tierName} · {deal.counterpartTrust.completed}{" "}
                completed · {deal.counterpartTrust.disputesLost} lost disputes
              </p>
            )}
          </Card>

          <Card>
            <div className="card-head">
              <span className="label">On-chain</span>
              <a
                className="link"
                href={deal.mstscanUrls.escrow}
                target="_blank"
                rel="noreferrer noopener"
              >
                Escrow contract
              </a>
            </div>
            {deal.timeline.length === 0 ? (
              <p className="faint">No transactions yet.</p>
            ) : (
              <ol className="timeline">
                {deal.timeline.map((entry) => (
                  <li key={`${entry.txHash}-${entry.event}`}>
                    <span>{entry.label}</span>
                    <a
                      className="address"
                      href={entry.url}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      {fmt(entry.at)} <IconExternal />
                    </a>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <aside className="deal-aside">
          <Card>
            <div className="stack" style={{ gap: 16 }}>
              <span className="label">Next step</span>
              {deal.nextAction === "PAY" && (
                <div className="stack" style={{ gap: 4 }}>
                  <span className="stat-value">{inr(deal.payAmount.inr)}</span>
                  <span className="stat-sub">{deal.payAmount.mstc} MSTC · price + deposit</span>
                </div>
              )}
              {!actionable && (
                <p className="title-3">{REASONS[deal.actionReason ?? ""] ?? "Nothing to do."}</p>
              )}
              {needsBrowserWallet && anyAction && (
                <p className="alert">
                  Connect your crypto wallet to sign.&nbsp;
                  <Link className="link" href="/login">
                    Connect it
                  </Link>
                </p>
              )}

              {deal.nextAction === "PAY" && deal.type === "BuyForYou" && (
                <DeliveryForm value={details} onChange={setDetails} />
              )}
              {deal.nextAction === "MARK_DELIVERED" && (
                <>
                  <Field label="Order id" htmlFor="order">
                    <input
                      id="order"
                      className="input input-mono"
                      placeholder="OD-4021-5550"
                      value={orderId}
                      onChange={(e) => setOrderId(e.target.value)}
                    />
                  </Field>
                  <Field label="Note" htmlFor="notes" hint="Optional">
                    <input
                      id="notes"
                      className="input"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                    />
                  </Field>
                  <Field
                    label="Invoice"
                    htmlFor="invoice"
                    hint="PDF, JPEG or PNG · up to 2 MB · optional"
                  >
                    <input
                      id="invoice"
                      type="file"
                      accept="application/pdf,image/jpeg,image/png"
                      onChange={(e) => setInvoice(e.target.files?.[0])}
                    />
                  </Field>
                </>
              )}
              {actionable && (
                <>
                  <Button
                    block
                    size="lg"
                    loading={action.isPending}
                    onClick={() =>
                      run(deal.nextAction, {
                        details:
                          deal.nextAction === "PAY" && deal.type === "BuyForYou"
                            ? cleanDetails(details)
                            : undefined,
                        proof:
                          deal.nextAction === "MARK_DELIVERED"
                            ? { orderId, notes: notes || undefined, invoice }
                            : undefined,
                      })
                    }
                  >
                    {action.isPending ? "Confirming in wallet…" : PRIMARY_LABELS[deal.nextAction]}
                    {!action.isPending &&
                      deal.nextAction === "PAY" &&
                      ` ${inr(deal.payAmount.inr)}`}
                  </Button>
                  {action.isPending && (
                    <p
                      className="faint"
                      style={{ fontSize: 13, textAlign: "center", margin: "4px 0 0" }}
                    >
                      Please approve the prompt in your BridgeKey or MetaMask extension.
                    </p>
                  )}
                </>
              )}

              {deal.secondaryActions.length > 0 && (
                <div className="row" style={{ gap: 8 }}>
                  {deal.secondaryActions.map((name) =>
                    name === "RAISE_DISPUTE" || name === "ADD_EVIDENCE" ? (
                      <Button
                        key={name}
                        variant="ghost"
                        size="sm"
                        onClick={() => setOpenForm(openForm === name ? null : name)}
                      >
                        {SECONDARY_LABELS[name]}
                      </Button>
                    ) : (
                      <Button
                        key={name}
                        variant={name === "CANCEL" ? "danger" : "ghost"}
                        size="sm"
                        disabled={action.isPending}
                        onClick={() => run(name)}
                      >
                        {SECONDARY_LABELS[name]}
                      </Button>
                    ),
                  )}
                </div>
              )}
              {(openForm === "RAISE_DISPUTE" || openForm === "ADD_EVIDENCE") && (
                <div className="stack" style={{ gap: 12 }}>
                  <Field label="What happened?" htmlFor="claim">
                    <select
                      id="claim"
                      className="select"
                      value={claim}
                      onChange={(e) => setClaim(e.target.value as EvidenceClaim)}
                    >
                      {CLAIMS.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Describe it" htmlFor="evidence">
                    <textarea
                      id="evidence"
                      className="textarea"
                      value={evidenceText}
                      onChange={(e) => setEvidenceText(e.target.value)}
                    />
                  </Field>
                  <Field label="Photos or documents" htmlFor="files" hint="Up to 3">
                    <input
                      id="files"
                      type="file"
                      multiple
                      accept="application/pdf,image/jpeg,image/png"
                      onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 3))}
                    />
                  </Field>
                  <Button
                    block
                    loading={action.isPending}
                    onClick={() => run(openForm, { evidence })}
                  >
                    Submit
                  </Button>
                </div>
              )}
              {lastTx && (
                <p className="alert alert-success">
                  Confirmed on-chain.&nbsp;
                  <a className="link" href={lastTx} target="_blank" rel="noreferrer noopener">
                    View
                  </a>
                </p>
              )}
              <ErrorText error={error} />
            </div>
          </Card>

          <MissingDeliveryDetails deal={deal} />
          <PrivatePanels deal={deal} />

          <div className="row" style={{ gap: 8, justifyContent: "center", margin: "4px 0" }}>
            <a
              href={`bridgekey://open?url=${encodeURIComponent(
                typeof window !== "undefined" ? window.location.href : "",
              )}`}
              className="pill pill-subtle"
              style={{
                fontSize: 12,
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 10px",
              }}
              title="Open deal in BridgeKey mobile wallet"
            >
              📱 Open in BridgeKey
            </a>
          </div>

          <p className="row faint" style={{ gap: 8, fontSize: 13 }}>
            <IconShield /> Never share card numbers, logins or OTPs.
          </p>
        </aside>
      </div>
    </main>
  );
}

function Party({ label, address, you }: { label: string; address: string; you: boolean }) {
  return (
    <div className="party">
      <Avatar address={address} size={40} />
      <div className="stack" style={{ gap: 2 }}>
        <span className="label">
          {label}
          {you && " · you"}
        </span>
        <Link className="num" href={`/badge/${address}`} style={{ fontSize: 14 }}>
          {shortAddress(address)}
        </Link>
      </div>
    </div>
  );
}

const EMPTY_DETAILS: DeliveryDetails = { name: "", phone: "", addressLines: [""], pincode: "" };

/** Trims every address line and drops the empty ones. */
const cleanDetails = (details: DeliveryDetails): DeliveryDetails => ({
  ...details,
  addressLines: details.addressLines.map((line) => line.trim()).filter(Boolean),
});

/** The delivery form's state, starting from the address last used on this device. */
function useDeliveryDetails() {
  const { accountId } = useRewardRelay();
  const [details, setDetails] = useState<DeliveryDetails>(
    () => loadSavedDelivery(accountId) ?? EMPTY_DETAILS,
  );
  useEffect(() => saveDelivery(cleanDetails(details), accountId), [details, accountId]);
  return [details, setDetails] as const;
}

function DeliveryForm({
  value,
  onChange,
}: {
  value: DeliveryDetails;
  onChange: (details: DeliveryDetails) => void;
}) {
  return (
    <div className="stack" style={{ gap: 12 }}>
      <span className="label">Deliver to</span>
      <input
        className="input"
        aria-label="Full name"
        placeholder="Full name"
        autoComplete="name"
        value={value.name}
        onChange={(e) => onChange({ ...value, name: e.target.value })}
      />
      <input
        className="input input-mono"
        aria-label="Mobile number"
        placeholder="Mobile number"
        inputMode="tel"
        autoComplete="tel"
        value={value.phone}
        onChange={(e) => onChange({ ...value, phone: e.target.value })}
      />
      <textarea
        className="textarea"
        aria-label="Address"
        placeholder="Address"
        autoComplete="street-address"
        value={value.addressLines.join("\n")}
        onChange={(e) =>
          onChange({ ...value, addressLines: e.target.value.split("\n").slice(0, 4) })
        }
      />
      <input
        className="input input-mono"
        aria-label="PIN code"
        placeholder="PIN code"
        inputMode="numeric"
        autoComplete="postal-code"
        value={value.pincode}
        onChange={(e) => onChange({ ...value, pincode: e.target.value })}
      />
    </div>
  );
}

/**
 * A paid Buy-for-you deal without a delivery address (e.g. the details failed after the payment):
 * the seeker can send it here, and the sharer is told to wait for it.
 */
function MissingDeliveryDetails({ deal }: { deal: DealView }) {
  const send = useSendDeliveryDetails(deal.id);
  const [details, setDetails] = useDeliveryDetails();
  if (deal.deliveryDetailsSent !== false || deal.status !== "Locked") return null;
  if (deal.role === "sharer") {
    return (
      <Card>
        <p className="muted">Waiting for the buyer&apos;s address before you order.</p>
      </Card>
    );
  }
  return (
    <Card>
      <div className="stack" style={{ gap: 16 }}>
        <h2 className="h-sm">Send your delivery address</h2>
        <DeliveryForm value={details} onChange={setDetails} />
        <Button block loading={send.isPending} onClick={() => send.mutate(cleanDetails(details))}>
          Send address
        </Button>
        <ErrorText error={send.error} />
      </div>
    </Card>
  );
}

/** Delivery details (sharer), order proof (both parties), code reveal (Pass-on seeker). */
function PrivatePanels({ deal }: { deal: DealView }) {
  const { api } = useRewardRelay();
  const [details, setDetails] = useState<DeliveryDetails | null>(null);
  const [proof, setProof] = useState<ProofView | null>(null);
  const [code, setCode] = useState<RevealedCode | null>(null);
  const [invoiceUrl, setInvoiceUrl] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = async (work: () => Promise<void>) => {
    setError(null);
    try {
      await work();
    } catch (caught) {
      setError(caught);
    }
  };

  const sharerSeesDetails =
    deal.role === "sharer" &&
    deal.type === "BuyForYou" &&
    ["Locked", "Delivered"].includes(deal.status);
  const proofVisible =
    deal.type === "BuyForYou" &&
    ((deal.role === "sharer" && deal.status !== "Listed" && deal.status !== "Cancelled") ||
      (deal.role === "seeker" &&
        ["Delivered", "Disputed", "Completed", "Resolved"].includes(deal.status)));
  const codeVisible =
    deal.role === "seeker" &&
    deal.type === "PassOn" &&
    ["Delivered", "Disputed", "Completed"].includes(deal.status);
  if (!sharerSeesDetails && !proofVisible && !codeVisible) return null;

  return (
    <Card>
      <div className="stack" style={{ gap: 16 } as CSSProperties}>
        <span className="label">Private</span>
        {sharerSeesDetails &&
          (details ? (
            <dl className="kv">
              <dt>Name</dt>
              <dd>{details.name}</dd>
              <dt>Phone</dt>
              <dd>{details.phone}</dd>
              <dt>Address</dt>
              <dd>{details.addressLines.join(", ")}</dd>
              <dt>PIN code</dt>
              <dd>{details.pincode}</dd>
            </dl>
          ) : (
            <Button
              variant="outline"
              block
              onClick={() =>
                load(async () => setDetails((await api.deals.getDetails(deal.id)).details))
              }
            >
              Show delivery address
            </Button>
          ))}
        {proofVisible &&
          (proof ? (
            <div className="stack" style={{ gap: 8 }}>
              <dl className="kv">
                <dt>Order id</dt>
                <dd>{proof.orderId}</dd>
                {proof.notes && (
                  <>
                    <dt>Note</dt>
                    <dd>{proof.notes}</dd>
                  </>
                )}
              </dl>
              {proof.matchesChain ? (
                <span className="pill pill-success pill-dot">Matches the chain</span>
              ) : (
                <span className="pill pill-danger pill-dot">Does not match the chain</span>
              )}
              {proof.invoice && !invoiceUrl && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    load(async () =>
                      setInvoiceUrl(URL.createObjectURL(await api.deals.invoice(deal.id))),
                    )
                  }
                >
                  Load invoice
                </Button>
              )}
              {invoiceUrl && (
                <a className="link" href={invoiceUrl} download={`invoice-${deal.id}`}>
                  Download invoice
                </a>
              )}
            </div>
          ) : (
            <Button
              variant="outline"
              block
              onClick={() => load(async () => setProof(await api.deals.getProof(deal.id)))}
            >
              Show order proof
            </Button>
          ))}
        {codeVisible &&
          (code ? (
            <div className="stack" style={{ gap: 8 }}>
              <div className="code-box">
                <span>{code.code}</span>
                <CopyButton text={code.code} label="Copy code" />
              </div>
              <span className="faint" style={{ fontSize: 12 }}>
                First revealed {new Date(code.firstRevealedAt).toLocaleString("en-IN")}
              </span>
            </div>
          ) : (
            <Button block onClick={() => load(async () => setCode(await api.deals.code(deal.id)))}>
              Reveal code
            </Button>
          ))}
        <ErrorText error={error} />
      </div>
    </Card>
  );
}
