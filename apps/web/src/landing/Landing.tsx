"use client";

import Link from "next/link";
import Image from "next/image";
import type { CSSProperties } from "react";
import { Avatar, Button, IconArrowRight, IconExternal, Pill, SectionHeader } from "@/components/ds";
import { DealDiagram } from "./DealDiagram";
import { LandingNav } from "./LandingNav";
import { PixelField } from "./PixelField";

const ESCROW_URL =
  "https://testnet.mstscan.com/address/0x5aB34fB9CFce4a442b2CA773692a7D031D173C9A#code";
const GITHUB_URL = "https://github.com/Atharvchaskar008/SAKAR";

const REASONS = [
  {
    idx: "01",
    title: "Escrow on every deal",
    text: "Your payment sits in a smart contract, never in a company's account.",
  },
  {
    idx: "02",
    title: "Deposits on both sides",
    text: "Cheat or miss a deadline, and your deposit goes to the other side.",
  },
  {
    idx: "03",
    title: "Refund if it never arrives",
    text: "No delivery by the deadline? The contract refunds you on its own.",
  },
];

const LOOP = [
  { n: "01", title: "List", text: "The cardholder posts the offer and locks a deposit." },
  { n: "02", title: "Lock", text: "You pay into escrow. Nobody can touch the money." },
  { n: "03", title: "Release", text: "Delivered and checked? The contract pays out." },
];

const TIERS = [
  { name: "New", deposit: "50%", how: "Phone sign-up", density: 0.25 },
  { name: "Trusted", deposit: "30%", how: "5 deals, 3 people", density: 0.5 },
  { name: "Verified", deposit: "20%", how: "20 deals, 10 people", density: 0.8 },
];

const TEAM = [
  {
    initials: "AC",
    name: "Atharv Chaskar",
    role: "Founder · product, blockchain and backend",
    href: "https://github.com/Atharvchaskar008",
    handle: "github.com/Atharvchaskar008",
  },
  {
    initials: "BS",
    name: "Bhavjot Singh",
    role: "Co-founder · frontend and UI",
    href: "https://github.com/bhavsingh-gpu",
    handle: "github.com/bhavsingh-gpu",
  },
];

const FAQ = [
  {
    q: "Do I ever share my card?",
    a: "No. The cardholder orders in their own account and ships to you. No card number, login or OTP ever changes hands.",
  },
  {
    q: "What if the order is cancelled or returned?",
    a: "The payout stays frozen until the return window ends. A dispute goes to an arbiter, and if nothing is delivered in time the contract refunds you automatically.",
  },
  {
    q: "What do I need to start?",
    a: "Just a phone number. A wallet is created for you. If you already use crypto, connect BridgeKey or MetaMask instead.",
  },
  {
    q: "Why a blockchain?",
    a: "Your money sits in public code nobody can run off with, the same code can never be sold twice, and your reputation travels with you.",
  },
  {
    q: "Is it live?",
    a: "Yes, on MST Testnet with test MSTC, so no real money moves yet. Mainnet is next.",
  },
];

/** A tiny pixel mark whose fill grows with the tier. */
function TierMark({ density }: { density: number }) {
  const cells = Array.from({ length: 36 }, (_, i) => {
    const x = i % 6;
    const y = Math.floor(i / 6);
    const v = Math.abs(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
    return { x, y, on: v < density };
  });
  return (
    <svg viewBox="0 0 6 6" width="48" height="48" shapeRendering="crispEdges" aria-hidden="true">
      {cells.map((c) =>
        c.on ? (
          <rect
            key={`${c.x}-${c.y}`}
            x={c.x}
            y={c.y}
            width="0.86"
            height="0.86"
            fill="var(--accent)"
          />
        ) : null,
      )}
    </svg>
  );
}

/** Corner crosses matching the Arccheo architectural visual style */
function Crosses() {
  return (
    <>
      <span className="corner-cross corner-cross-tl" aria-hidden="true" />
      <span className="corner-cross corner-cross-tr" aria-hidden="true" />
      <span className="corner-cross corner-cross-bl" aria-hidden="true" />
      <span className="corner-cross corner-cross-br" aria-hidden="true" />
    </>
  );
}

export function Landing() {
  return (
    <>
      <LandingNav />
      <main id="top" className="landing-main">
        {/* Hero */}
        <section className="hero">
          {/* Arccheo Halftone Architectural Backdrop */}
          <div className="hero-bg-art" aria-hidden="true">
            <Image
              src="/arccheo/0w0qwEFKa288EqQq2SBotntUpbE.png"
              alt=""
              fill
              priority
              className="hero-art-img"
            />
          </div>
          <PixelField
            className="hero-field"
            seed={3}
            clearZone={{ x: 0, y: 0.45, w: 0.6, h: 0.55 }}
          />

          <div className="container hero-inner">
            <div className="hero-card has-crosses">
              <Crosses />
              <div className="hero-copy stack">
                <div className="eyebrow-wrapper">
                  <span className="eyebrow">Escrow for card offers · on MST Blockchain</span>
                </div>
                <h1 className="display">
                  Their card.
                  <br />
                  Your discount.
                </h1>
                <p className="lead">
                  Someone else holds the bank offer you need. SAKAR lets them buy for you, while
                  your money waits in a smart contract until the order arrives.
                </p>
                <div className="row hero-actions">
                  <Button href="/dashboard" size="lg" className="hero-btn-primary">
                    Open app
                  </Button>
                  <Button href="#how" variant="outline" size="lg" className="hero-btn-secondary">
                    How it works
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Proof strip */}
        <div className="proof">
          <div className="container row-between proof-inner">
            <p className="mono proof-items">
              <span>Built on MST Blockchain</span>
              <span>Contracts verified on mstscan</span>
              <span>Works with BridgeKey and MetaMask</span>
            </p>
            <div className="row proof-right-col" style={{ gap: 24, alignItems: "center" }}>
              <div className="proof-logos" aria-hidden="true">
                <Image
                  src="/arccheo/aO7VZrPNpr17rAk31OBOjUvQtM.svg"
                  alt=""
                  width={56}
                  height={20}
                  className="proof-svg"
                />
                <Image
                  src="/arccheo/WCnJFcqKv9UbCn8e5O52hdSAsQ.svg"
                  alt=""
                  width={56}
                  height={20}
                  className="proof-svg"
                />
                <Image
                  src="/arccheo/hq51MC556sUgci2Mvg5s7IwaM0Y.svg"
                  alt=""
                  width={42}
                  height={20}
                  className="proof-svg"
                />
              </div>
              <a
                className="mono proof-link"
                href={ESCROW_URL}
                target="_blank"
                rel="noreferrer noopener"
              >
                View contract <IconExternal />
              </a>
            </div>
          </div>
        </div>

        {/* Problem */}
        <section className="lsection">
          <div className="container">
            <div className="split-box has-crosses">
              <Crosses />
              <div className="split">
                <SectionHeader
                  eyebrow="The problem"
                  title="Every card hides a discount someone else needs."
                  size={1}
                />
                <p className="lead split-aside">
                  Bank offers, cashback and no-cost EMI are locked to a few cardholders. The buyer
                  who wants the deal has no card. The cardholder has no reason to trust a stranger.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Why */}
        <section className="lsection lsection-line">
          <div className="container stack" style={{ gap: 48 }}>
            <SectionHeader eyebrow="Why SAKAR" title="Trust, without the middleman." size={1} />
            <div className="grid reasons-grid" style={{ "--cols": 3 } as CSSProperties}>
              {REASONS.map((reason) => (
                <div key={reason.title} className="reason-card has-crosses">
                  <Crosses />
                  <span className="mono reason-idx">[ {reason.idx} ]</span>
                  <h3 className="title-3">— {reason.title}</h3>
                  <p className="muted">{reason.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="lsection lsection-line">
          <div className="container stack" style={{ gap: 48 }}>
            <SectionHeader
              eyebrow="The loop"
              title="List. Lock. Release."
              lead="One deal, three moves. Every step is a transaction you can check on mstscan."
              size={1}
            />
            <div className="card diagram-card has-crosses">
              <Crosses />
              <DealDiagram />
            </div>
            <div className="grid loop-grid" style={{ "--cols": 3 } as CSSProperties}>
              {LOOP.map((step) => (
                <div key={step.n} className="card step-card has-crosses">
                  <Crosses />
                  <div className="row-between">
                    <span className="mono step-tag">PHASE {step.n}</span>
                    <span className="num step-n">{step.n}</span>
                  </div>
                  <h3 className="title-2">{step.title}</h3>
                  <p className="muted">{step.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Stats */}
        <section className="stats">
          <div className="container">
            <div className="stats-grid has-crosses">
              <Crosses />
              <div className="stats-item">
                <span className="stats-value num">2%</span>
                <span className="label">Fee, only on the payout</span>
              </div>
              <div className="stats-item">
                <span className="stats-value num">0</span>
                <span className="label">Card numbers or OTPs shared</span>
              </div>
              <div className="stats-item">
                <span className="stats-value num">~3s</span>
                <span className="label">Per block on MST</span>
              </div>
            </div>
          </div>
        </section>

        {/* Two ways */}
        <section className="lsection">
          <div className="container stack" style={{ gap: 48 }}>
            <SectionHeader
              eyebrow="Two ways to share"
              title="One flow, two kinds of rewards."
              size={1}
            />
            <div className="grid ways-grid" style={{ "--cols": 2 } as CSSProperties}>
              <div className="card way-card has-crosses">
                <Crosses />
                <div className="way-art">
                  <Image
                    src="/arccheo/gxCnqw18lajATdEzbHQtI9Ud4c.png"
                    alt=""
                    width={400}
                    height={220}
                    className="way-img"
                  />
                </div>
                <div className="way-body stack" style={{ gap: 12 }}>
                  <Pill tone="accent">Card offers</Pill>
                  <h3 className="title-2">Buy-for-you</h3>
                  <p className="muted">
                    The cardholder orders in their own account and ships to you. The payout waits
                    for the return window.
                  </p>
                </div>
              </div>

              <div className="card way-card has-crosses">
                <Crosses />
                <div className="way-art">
                  <Image
                    src="/arccheo/2kfLIBd1mfhRBldMqHLvDwR0tY.png"
                    alt=""
                    width={400}
                    height={220}
                    className="way-img"
                  />
                </div>
                <div className="way-body stack" style={{ gap: 12 }}>
                  <Pill>Codes and vouchers</Pill>
                  <h3 className="title-2">Pass-on</h3>
                  <p className="muted">
                    A shareable code is sealed on-chain and revealed only to the buyer who paid.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Trust Badge */}
        <section id="trust" className="lsection lsection-line">
          <div className="container stack" style={{ gap: 48 }}>
            <SectionHeader
              eyebrow="Reputation"
              title="Trust you can carry."
              lead="Every finished deal adds to a soulbound Trust Badge on MST. Better reputation, smaller deposits."
              size={1}
            />
            <div className="grid tiers-grid" style={{ "--cols": 3 } as CSSProperties}>
              {TIERS.map((tier) => (
                <div key={tier.name} className="card tier-card has-crosses">
                  <Crosses />
                  <div className="row-between">
                    <span className="label">Trust Badge</span>
                    <TierMark density={tier.density} />
                  </div>
                  <h3 className="title-2">{tier.name}</h3>
                  <dl className="kv">
                    <dt>Deposit</dt>
                    <dd>{tier.deposit}</dd>
                    <dt>Earned by</dt>
                    <dd>{tier.how}</dd>
                  </dl>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Team */}
        <section id="team" className="lsection lsection-line">
          <div className="container stack" style={{ gap: 48 }}>
            <SectionHeader eyebrow="The team" title="Two people, one escrow." size={1} />
            <div className="grid team-grid" style={{ "--cols": 2 } as CSSProperties}>
              {TEAM.map((person) => (
                <div key={person.name} className="card person-card has-crosses">
                  <Crosses />
                  <Avatar initials={person.initials} size={64} label={person.name} />
                  <div className="stack" style={{ gap: 6 }}>
                    <h3 className="title-3">{person.name}</h3>
                    <p className="muted">{person.role}</p>
                    <a
                      className="mono link person-link"
                      href={person.href}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      {person.handle} <IconExternal />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="lsection lsection-line">
          <div className="container split">
            <SectionHeader eyebrow="Questions" title="Before you start." size={1} />
            <div className="accordion-wrapper has-crosses">
              <Crosses />
              <div className="accordion">
                {FAQ.map((item) => (
                  <details key={item.q} className="faq-item">
                    <summary className="faq-summary">
                      <span>{item.q}</span>
                      <span className="faq-icon" aria-hidden="true" />
                    </summary>
                    <div className="faq-answer">
                      <p>{item.a}</p>
                    </div>
                  </details>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Closing */}
        <section className="closing">
          <div className="closing-art" aria-hidden="true">
            <Image
              src="/arccheo/Gin5w9Fy7PmtsSiAcRhgvL7X3T4.png"
              alt=""
              fill
              className="closing-img"
            />
          </div>
          <PixelField
            className="closing-field"
            seed={11}
            bias={-0.06}
            clearZone={{ x: 0, y: 0, w: 0.62, h: 1 }}
          />
          <div className="container">
            <div className="closing-card has-crosses">
              <Crosses />
              <div className="closing-inner stack">
                <h2 className="title-1">
                  Your card has a discount
                  <br />
                  someone else needs.
                </h2>
                <div className="row closing-actions" style={{ gap: 12 }}>
                  <Button href="/dashboard" size="lg" className="hero-btn-primary">
                    Open app
                  </Button>
                  <Button
                    href="/explore"
                    variant="outline"
                    size="lg"
                    className="hero-btn-secondary"
                  >
                    Explore offers <IconArrowRight />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="lfooter">
        <div className="container lfooter-top">
          <div className="stack" style={{ gap: 8 }}>
            <Link href="/" className="wordmark">
              SAKAR
            </Link>
            <p className="muted" style={{ maxWidth: 320 }}>
              Card offers for everyone, settled by smart contracts on MST Blockchain.
            </p>
          </div>
          <nav className="lfooter-cols" aria-label="Footer">
            <div className="stack" style={{ gap: 10 }}>
              <span className="label">Product</span>
              <Link href="/explore">Explore</Link>
              <Link href="/listings/new">Share an offer</Link>
              <Link href="/deals">My deals</Link>
              <Link href="/wallet">Profile</Link>
            </div>
            <div className="stack" style={{ gap: 10 }}>
              <span className="label">Project</span>
              <a href={GITHUB_URL} target="_blank" rel="noreferrer noopener">
                GitHub
              </a>
              <a href={ESCROW_URL} target="_blank" rel="noreferrer noopener">
                Contracts
              </a>
              <a
                href={`${GITHUB_URL}/blob/main/.github/SECURITY.md`}
                target="_blank"
                rel="noreferrer noopener"
              >
                Security
              </a>
            </div>
            <div className="stack" style={{ gap: 10 }}>
              <span className="label">Legal</span>
              <Link href="/terms">Terms</Link>
            </div>
          </nav>
        </div>
        <div className="container lfooter-bottom mono">
          <span>© 2026 SAKAR · Built on MST Blockchain</span>
          <span>Designed by Atharv Chaskar</span>
        </div>
      </footer>
    </>
  );
}
