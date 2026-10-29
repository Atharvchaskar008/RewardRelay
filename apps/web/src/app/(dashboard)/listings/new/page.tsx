"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  BLOCKED_TOPICS,
  CATEGORIES,
  CATEGORY_LABELS,
  categoryByKey,
  findBlockedTopic,
  inrToWei,
  weiToMstc,
} from "@rewardrelay/shared";
import { ErrorText, Page, RequireSignIn } from "@/components/ui";
import { Button, Card, Field, inr } from "@/components/ds";
import { appConfig } from "@/client/config";
import { listBuyForYou, listPassOn, useMe, useSdkContext, useWallet } from "@/client/sdk";

/** Create a listing: category (allowlist), ₹ values converted to MSTC, declaration, code for Pass-on. */
export default function NewListingPage() {
  return (
    <Page eyebrow="Share" title="Share an offer">
      <RequireSignIn>
        <ListingForm />
      </RequireSignIn>
    </Page>
  );
}

const WITH_EVENT = new Set(["travel", "movies"]);
/** Sharer deposit by Trust Badge tier (New, Trusted, Verified), as configured on-chain. */
const DEPOSIT_BPS = [5000, 3000, 2000];
const FEE_BPS = 200;

function ListingForm() {
  const router = useRouter();
  const me = useMe();
  const wallet = useWallet();
  const sdk = useSdkContext();
  const [category, setCategory] = useState("ecommerce");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [faceValue, setFaceValue] = useState("");
  const [price, setPrice] = useState("");
  const [eventAt, setEventAt] = useState("");
  const [validTill, setValidTill] = useState("");
  const [code, setCode] = useState("");
  const [declared, setDeclared] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const entry = categoryByKey(category);
  const passOn = entry?.dealType === "PassOn";
  const priceWei = useMemo(() => {
    const value = Number(price);
    return value > 0 ? inrToWei(value, appConfig.inrPerMstc) : 0n;
  }, [price]);
  const blocked = findBlockedTopic(title, description);
  const depositBps = DEPOSIT_BPS[me.data?.tier ?? 0] ?? DEPOSIT_BPS[0];
  const depositWei = (priceWei * BigInt(depositBps)) / 10_000n;
  const saving = Math.max(0, (Number(faceValue) || 0) - (Number(price) || 0));

  const switchType = (type: "BuyForYou" | "PassOn") => {
    const first = CATEGORIES.find((item) => item.dealType === type);
    if (first) setCategory(first.key);
  };

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const draft = {
        title: title.trim(),
        description: description.trim(),
        category,
        faceValueInr: Number(faceValue) || 0,
        priceInr: Number(price),
        eventTime:
          WITH_EVENT.has(category) && eventAt ? Math.floor(new Date(eventAt).getTime() / 1000) : 0,
        terms: (validTill ? { validTill } : {}) as Record<string, string>,
      };
      const result = passOn
        ? await listPassOn(sdk(), draft, code)
        : await listBuyForYou(sdk(), draft);
      router.push(`/deal/${result.listing.dealId}`);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  if (!me.isLoading && !me.data) {
    return (
      <Card className="signin-card">
        <h2 className="title-3">Finish signing up</h2>
        <p className="muted">You need a Trust Badge to share offers.</p>
        <Button href="/login">Continue</Button>
      </Card>
    );
  }

  const disabled =
    busy ||
    !declared ||
    Boolean(blocked) ||
    !title.trim() ||
    !(Number(price) > 0) ||
    (passOn && !code.trim());

  return (
    <div className="create-layout">
      <Card>
        <div className="stack" style={{ gap: 24 }}>
          <div className="segmented" role="group" aria-label="Offer type">
            <button type="button" aria-pressed={!passOn} onClick={() => switchType("BuyForYou")}>
              Card offer
            </button>
            <button type="button" aria-pressed={passOn} onClick={() => switchType("PassOn")}>
              Code
            </button>
          </div>
          <p className="faint" style={{ fontSize: 14, marginTop: -8 }}>
            {passOn
              ? "Your code is sealed and revealed only to the buyer who pays."
              : "You order with your card and ship to the buyer, then add the order id."}
          </p>

          <div className="form-grid">
            <div className="span-2">
              <Field label="Category" htmlFor="category">
                <select
                  id="category"
                  className="select"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  {CATEGORIES.filter(
                    (item) => item.dealType === (passOn ? "PassOn" : "BuyForYou"),
                  ).map((item) => (
                    <option key={item.key} value={item.key}>
                      {CATEGORY_LABELS[item.key]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="span-2">
              <Field
                label="Title"
                htmlFor="title"
                hint="For example: 10% off on Flipkart with an HDFC card"
              >
                <input
                  id="title"
                  className="input"
                  value={title}
                  maxLength={80}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </Field>
            </div>
            <div className="span-2">
              <Field label="Details" htmlFor="description" hint="Optional">
                <textarea
                  id="description"
                  className="textarea"
                  value={description}
                  maxLength={500}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </Field>
            </div>
            <Field label="Worth (₹)" htmlFor="face">
              <input
                id="face"
                className="input input-mono"
                inputMode="decimal"
                value={faceValue}
                onChange={(e) => setFaceValue(e.target.value)}
              />
            </Field>
            <Field label="Price (₹)" htmlFor="price">
              <input
                id="price"
                className="input input-mono"
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </Field>
            {WITH_EVENT.has(category) && (
              <Field label="Journey or show time" htmlFor="event">
                <input
                  id="event"
                  className="input"
                  type="datetime-local"
                  value={eventAt}
                  onChange={(e) => setEventAt(e.target.value)}
                />
              </Field>
            )}
            <Field label="Valid till" htmlFor="valid" hint="Optional">
              <input
                id="valid"
                className="input"
                type="date"
                value={validTill}
                onChange={(e) => setValidTill(e.target.value)}
              />
            </Field>
            {passOn && (
              <div className="span-2">
                <Field label="Code" htmlFor="code">
                  <input
                    id="code"
                    className="input input-mono"
                    value={code}
                    autoComplete="off"
                    onChange={(e) => setCode(e.target.value)}
                  />
                </Field>
              </div>
            )}
          </div>

          {blocked && <p className="alert alert-danger">Not allowed on SAKAR: {blocked.label}.</p>}
          <label className="checkbox">
            <input
              type="checkbox"
              checked={declared}
              onChange={(e) => setDeclared(e.target.checked)}
            />
            <span>
              This offer is mine to share, and I&apos;ll never ask for or share card numbers, logins
              or OTPs.
              <span className="faint" style={{ display: "block", fontSize: 12, marginTop: 4 }}>
                Not allowed: {BLOCKED_TOPICS.map((topic) => topic.label).join(" · ")}
              </span>
            </span>
          </label>
        </div>
      </Card>

      <aside className="deal-aside">
        <Card>
          <div className="stack" style={{ gap: 16 }}>
            <span className="label">Summary</span>
            <div className="stack" style={{ gap: 4 }}>
              <span className="stat-value">{inr(Number(price) || 0)}</span>
              <span className="stat-sub">
                {priceWei > 0n ? `${weiToMstc(priceWei)} MSTC` : "Set a price"}
              </span>
            </div>
            <dl className="kv">
              <dt>Buyer saves</dt>
              <dd>{inr(saving)}</dd>
              <dt>Your deposit</dt>
              <dd>{weiToMstc(depositWei)} MSTC</dd>
              <dt>Fee</dt>
              <dd>{FEE_BPS / 100}% of payout</dd>
            </dl>
            <p className="faint" style={{ fontSize: 12 }}>
              Your deposit comes back when the deal ends well.
            </p>
            {!wallet.unlocked && (
              <p className="alert">
                Connect your crypto wallet to sign.&nbsp;
                <Link className="link" href="/login">
                  Connect it
                </Link>
              </p>
            )}
            <Button block size="lg" loading={busy} disabled={disabled} onClick={submit}>
              List offer
            </Button>
            <ErrorText error={error} />
          </div>
        </Card>
      </aside>
    </div>
  );
}
