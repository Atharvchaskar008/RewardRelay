"use client";

import Link from "next/link";
import { useState } from "react";
import { Banner, Card, ErrorText, ExplorerLink, Money, Page } from "@/components/ui";
import {
  useDeal,
  useDealAction,
  useRewardRelay,
  useWallet,
  type DealAction,
  type DealActionInput,
  type DealView,
  type DeliveryDetails,
  type EvidenceClaim,
  type ProofView,
  type RevealedCode,
} from "@/src/client/sdk";
import { useSession } from "@/app/providers";

/** The deal room: one primary button from nextAction, secondary actions, private-data panels. */
export default function DealPage({ params }: { params: { id: string } }) {
  const deal = useDeal(params.id);
  if (deal.isLoading) return <Page title={`Deal #${params.id}`}>Loading…</Page>;
  if (!deal.data) {
    return (
      <Page title={`Deal #${params.id}`}>
        <ErrorText error={deal.error} />
      </Page>
    );
  }
  return <DealRoom deal={deal.data} />;
}

const PRIMARY_LABELS: Partial<Record<DealAction, string>> = {
  PAY: "Pay",
  MARK_DELIVERED: "Submit order proof and mark delivered",
  CONFIRM: "Confirm I received it",
  RELEASE_AVAILABLE: "Release the payment",
  CLAIM_REFUND: "Claim my refund",
};

const SECONDARY_LABELS: Record<string, string> = {
  CANCEL: "Cancel listing",
  RAISE_DISPUTE: "Report a problem",
  ADD_EVIDENCE: "Add evidence",
  CONFIRM: "Withdraw the dispute and release",
  DEFAULT_RESOLVE: "Apply the 50/50 default ruling",
};

const REASONS: Record<string, string> = {
  SIGN_IN: "Sign in to pay for this deal.",
  NO_WALLET: "Finish signing up to get a wallet.",
  NO_BADGE: "You need a Trust Badge to pay.",
  OVER_LIMIT: "This deal is above your Trust Badge limit.",
  PAUSED: "New deals are paused right now.",
  EVENT_STARTED: "The event has already started.",
  AWAITING_SEEKER: "Waiting for a Seeker to pay.",
  AWAITING_DELIVERY: "Waiting for the Sharer to deliver.",
  IN_CHECK_WINDOW: "The Seeker is checking the delivery.",
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

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");

function DealRoom({ deal }: { deal: DealView }) {
  const wallet = useWallet();
  const action = useDealAction(deal.id);
  const { user } = useSession();
  const [pin, setPin] = useState("");
  const [details, setDetails] = useState<DeliveryDetails>({
    name: "",
    phone: "",
    addressLines: [""],
    pincode: "",
  });
  const [orderId, setOrderId] = useState("");
  const [notes, setNotes] = useState("");
  const [invoice, setInvoice] = useState<File | undefined>();
  const [claim, setClaim] = useState<EvidenceClaim>("not_as_described");
  const [evidenceText, setEvidenceText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [lastTx, setLastTx] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [openForm, setOpenForm] = useState<DealAction | null>(null);

  async function run(name: DealAction, input?: DealActionInput) {
    setError(null);
    try {
      if (!wallet.unlocked) await wallet.unlock(pin);
      const result = await action.mutateAsync({ action: name, input });
      setLastTx(result.tx?.explorerUrl ?? null);
      setOpenForm(null);
    } catch (caught) {
      setError(caught);
    }
  }

  const evidence = { claim, text: evidenceText, files };
  const needsPin = !wallet.unlocked && user;
  const actionable = deal.nextAction !== "WAIT" && deal.nextAction !== "NONE";

  return (
    <Page title={deal.listing?.title ?? `Deal #${deal.id}`}>
      <Banner>Never share card numbers, logins or OTPs. RewardRelay never needs them.</Banner>
      <Card>
        <p>
          <strong>{deal.statusLabel}</strong> ·{" "}
          {deal.type === "BuyForYou" ? "Buy-for-you" : "Pass-on code"} · {deal.categoryLabel}
        </p>
        {deal.listing?.description && <p>{deal.listing.description}</p>}
        <p>
          Price <Money value={deal.price} />
          {deal.listing && deal.listing.faceValueInr > 0 && (
            <span className="muted">
              {" "}
              · worth ₹{deal.listing.faceValueInr.toLocaleString("en-IN")}
            </span>
          )}
        </p>
        <p className="muted">
          Deposits: Sharer <Money value={deal.deposits.sharer} /> · Seeker{" "}
          <Money value={deal.deposits.seeker} /> · fee {deal.feeBps / 100}%
        </p>
        {Object.keys(deal.listing?.terms ?? {}).length > 0 && (
          <p className="muted">Terms: {JSON.stringify(deal.listing?.terms)}</p>
        )}
        <p className="muted">
          You are: {deal.role}
          {deal.counterpartTrust && (
            <>
              {" "}
              · other side:{" "}
              <Link href={`/badge/${deal.counterpartTrust.address}`}>
                {deal.counterpartTrust.tierName}
              </Link>{" "}
              ({deal.counterpartTrust.completed} completed, {deal.counterpartTrust.disputesLost}{" "}
              lost disputes)
            </>
          )}
        </p>
        <p className="muted">
          Deliver by {fmt(deal.deadlines.deliverBy)} · release from {fmt(deal.deadlines.releaseAt)}
          {deal.deadlines.eventTime && <> · event {fmt(deal.deadlines.eventTime)}</>}
          {deal.deadlines.evidenceUntil && (
            <> · evidence until {fmt(deal.deadlines.evidenceUntil)}</>
          )}
          {deal.deadlines.defaultRulingAt && (
            <> · default ruling from {fmt(deal.deadlines.defaultRulingAt)}</>
          )}
        </p>
      </Card>

      <Card>
        {!actionable && <p>{REASONS[deal.actionReason ?? ""] ?? ""}</p>}
        {needsPin && (actionable || deal.secondaryActions.length > 0) && (
          <>
            <label htmlFor="pin">Wallet PIN</label>
            <input
              id="pin"
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
            />
          </>
        )}

        {deal.nextAction === "PAY" && deal.type === "BuyForYou" && (
          <>
            <h2>Deliver to</h2>
            <input
              placeholder="Full name"
              value={details.name}
              onChange={(e) => setDetails({ ...details, name: e.target.value })}
            />
            <input
              placeholder="Mobile number"
              inputMode="tel"
              value={details.phone}
              onChange={(e) => setDetails({ ...details, phone: e.target.value })}
            />
            <textarea
              placeholder="Address (one line per row)"
              value={details.addressLines.join("\n")}
              onChange={(e) =>
                setDetails({ ...details, addressLines: e.target.value.split("\n").slice(0, 4) })
              }
            />
            <input
              placeholder="PIN code"
              inputMode="numeric"
              value={details.pincode}
              onChange={(e) => setDetails({ ...details, pincode: e.target.value })}
            />
          </>
        )}
        {deal.nextAction === "MARK_DELIVERED" && (
          <>
            <h2>Order proof</h2>
            <input
              placeholder="Order id / PNR"
              value={orderId}
              onChange={(e) => setOrderId(e.target.value)}
            />
            <input
              placeholder="Notes (optional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <label htmlFor="invoice">Invoice (PDF, JPEG or PNG, up to 2 MB, optional)</label>
            <input
              id="invoice"
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              onChange={(e) => setInvoice(e.target.files?.[0])}
            />
          </>
        )}
        {actionable && (
          <button
            className="primary"
            disabled={action.isPending}
            onClick={() =>
              run(deal.nextAction, {
                details:
                  deal.nextAction === "PAY" && deal.type === "BuyForYou"
                    ? { ...details, addressLines: details.addressLines.filter(Boolean) }
                    : undefined,
                proof:
                  deal.nextAction === "MARK_DELIVERED"
                    ? { orderId, notes: notes || undefined, invoice }
                    : undefined,
              })
            }
          >
            {action.isPending ? "Working…" : PRIMARY_LABELS[deal.nextAction]}
            {deal.nextAction === "PAY" && (
              <>
                {" "}
                {deal.payAmount.mstc} MSTC (≈ ₹{deal.payAmount.inr.toLocaleString("en-IN")})
              </>
            )}
          </button>
        )}

        <div className="row">
          {deal.secondaryActions.map((name) =>
            name === "RAISE_DISPUTE" || name === "ADD_EVIDENCE" ? (
              <button key={name} onClick={() => setOpenForm(openForm === name ? null : name)}>
                {SECONDARY_LABELS[name]}
              </button>
            ) : (
              <button key={name} disabled={action.isPending} onClick={() => run(name)}>
                {SECONDARY_LABELS[name]}
              </button>
            ),
          )}
        </div>
        {(openForm === "RAISE_DISPUTE" || openForm === "ADD_EVIDENCE") && (
          <>
            <label htmlFor="claim">What happened?</label>
            <select
              id="claim"
              value={claim}
              onChange={(e) => setClaim(e.target.value as EvidenceClaim)}
            >
              {CLAIMS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            <textarea
              placeholder="Describe it (at least 5 characters)"
              value={evidenceText}
              onChange={(e) => setEvidenceText(e.target.value)}
            />
            <label htmlFor="files">Photos or documents (up to 3)</label>
            <input
              id="files"
              type="file"
              multiple
              accept="application/pdf,image/jpeg,image/png"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 3))}
            />
            <button
              className="primary"
              disabled={action.isPending}
              onClick={() => run(openForm, { evidence })}
            >
              Submit
            </button>
          </>
        )}
        {lastTx && (
          <p className="success">
            Confirmed on-chain. <ExplorerLink href={lastTx}>View on mstscan</ExplorerLink>
          </p>
        )}
        <ErrorText error={error} />
      </Card>

      <PrivatePanels deal={deal} />

      <Card>
        <h2>Timeline</h2>
        <ul className="plain">
          {deal.timeline.map((entry) => (
            <li key={`${entry.txHash}-${entry.event}`}>
              {fmt(entry.at)} · {entry.label} · <ExplorerLink href={entry.url}>tx</ExplorerLink>
            </li>
          ))}
        </ul>
        <p className="row">
          <ExplorerLink href={deal.mstscanUrls.escrow}>Escrow contract</ExplorerLink>
          <ExplorerLink href={deal.mstscanUrls.sharer}>Sharer</ExplorerLink>
          <ExplorerLink href={deal.mstscanUrls.seeker}>Seeker</ExplorerLink>
        </p>
      </Card>
    </Page>
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
      {sharerSeesDetails &&
        (details ? (
          <p>
            Deliver to: <strong>{details.name}</strong>, {details.phone},{" "}
            {details.addressLines.join(", ")} – {details.pincode}
          </p>
        ) : (
          <button
            onClick={() =>
              load(async () => setDetails((await api.deals.getDetails(deal.id)).details))
            }
          >
            Show delivery details
          </button>
        ))}
      {proofVisible &&
        (proof ? (
          <p>
            Order id <strong>{proof.orderId}</strong> {proof.notes && <>({proof.notes})</>} ·{" "}
            {proof.matchesChain ? (
              <span className="success">matches the on-chain proof</span>
            ) : (
              <span className="error">does not match the chain</span>
            )}
            {proof.invoice && !invoiceUrl && (
              <button
                onClick={() =>
                  load(async () =>
                    setInvoiceUrl(URL.createObjectURL(await api.deals.invoice(deal.id))),
                  )
                }
              >
                Load invoice
              </button>
            )}
            {invoiceUrl && (
              <a href={invoiceUrl} download={`invoice-${deal.id}`}>
                Download invoice
              </a>
            )}
          </p>
        ) : (
          <button onClick={() => load(async () => setProof(await api.deals.getProof(deal.id)))}>
            Show order proof
          </button>
        ))}
      {codeVisible &&
        (code ? (
          <p>
            Your code: <code>{code.code}</code>{" "}
            <span className="muted">
              (first revealed {new Date(code.firstRevealedAt).toLocaleString()})
            </span>
          </p>
        ) : (
          <button
            className="primary"
            onClick={() => load(async () => setCode(await api.deals.code(deal.id)))}
          >
            Reveal code
          </button>
        ))}
      <ErrorText error={error} />
    </Card>
  );
}
