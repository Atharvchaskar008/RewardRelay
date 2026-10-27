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
import { Card, ErrorText, Page, RequireSignIn } from "@/components/ui";
import { appConfig } from "@/client/config";
import { listBuyForYou, listPassOn, useMe, useSdkContext, useWallet } from "@/client/sdk";

/** Create a listing: category (allowlist), ₹ values converted to MSTC, declaration, code for Pass-on. */
export default function NewListingPage() {
  return (
    <Page title="Share an offer">
      <RequireSignIn>
        <ListingForm />
      </RequireSignIn>
    </Page>
  );
}

const WITH_EVENT = new Set(["travel", "movies"]);

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
  const [pin, setPin] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const entry = categoryByKey(category);
  const passOn = entry?.dealType === "PassOn";
  const priceWei = useMemo(() => {
    const value = Number(price);
    return value > 0 ? inrToWei(value, appConfig.inrPerMstc) : 0n;
  }, [price]);
  const blocked = findBlockedTopic(title, description);
  const overLimit = me.data && priceWei > BigInt(me.data.badge.maxDealValue.wei);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (!wallet.unlocked) await wallet.unlock(pin);
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
      <p>
        <Link href="/login">Finish signing up</Link> to get your Trust Badge first.
      </p>
    );
  }

  return (
    <Card>
      <label htmlFor="category">Category</label>
      <select id="category" value={category} onChange={(e) => setCategory(e.target.value)}>
        {CATEGORIES.map((item) => (
          <option key={item.key} value={item.key}>
            {CATEGORY_LABELS[item.key]} ({item.dealType === "BuyForYou" ? "Buy-for-you" : "Pass-on"}
            )
          </option>
        ))}
      </select>
      <p className="muted">
        {passOn
          ? "Pass-on: your shareable code is sealed and revealed only to the Seeker who pays."
          : "Buy-for-you: you order in your own account and deliver to the Seeker, then submit the order id."}
      </p>

      <label htmlFor="title">Title</label>
      <input id="title" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
      <label htmlFor="description">Description</label>
      <textarea
        id="description"
        value={description}
        maxLength={500}
        onChange={(e) => setDescription(e.target.value)}
      />
      <label htmlFor="face">Face value (₹)</label>
      <input
        id="face"
        inputMode="decimal"
        value={faceValue}
        onChange={(e) => setFaceValue(e.target.value)}
      />
      <label htmlFor="price">Price the Seeker pays (₹)</label>
      <input
        id="price"
        inputMode="decimal"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
      />
      {priceWei > 0n && <p className="muted">= {weiToMstc(priceWei)} MSTC</p>}
      {overLimit && (
        <p className="error">
          This is above your Trust Badge limit ({me.data?.badge.maxDealValue.mstc} MSTC).
        </p>
      )}
      {WITH_EVENT.has(category) && (
        <>
          <label htmlFor="event">Journey / show time</label>
          <input
            id="event"
            type="datetime-local"
            value={eventAt}
            onChange={(e) => setEventAt(e.target.value)}
          />
        </>
      )}
      <label htmlFor="valid">Offer valid till (optional)</label>
      <input
        id="valid"
        type="date"
        value={validTill}
        onChange={(e) => setValidTill(e.target.value)}
      />
      {passOn && (
        <>
          <label htmlFor="code">Shareable code</label>
          <input
            id="code"
            value={code}
            autoComplete="off"
            onChange={(e) => setCode(e.target.value)}
          />
        </>
      )}

      {blocked && <p className="error">Not allowed on RewardRelay: {blocked.label}.</p>}
      <label className="row">
        <input type="checkbox" checked={declared} onChange={(e) => setDeclared(e.target.checked)} />
        I declare this benefit is mine to share, is not one of the blocked categories (
        {BLOCKED_TOPICS.map((topic) => topic.label).join("; ")}), and I will never ask for or share
        card numbers, logins or OTPs.
      </label>

      {!wallet.unlocked && (
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
      <button
        className="primary"
        disabled={
          busy ||
          !declared ||
          Boolean(blocked) ||
          !title.trim() ||
          !(Number(price) > 0) ||
          (passOn && !code.trim())
        }
        onClick={submit}
      >
        {busy ? "Listing…" : "List and lock my deposit"}
      </button>
      <ErrorText error={error} />
    </Card>
  );
}
