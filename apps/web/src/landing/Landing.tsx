"use client";

import Link from "next/link";
import Image from "next/image";
import { useState, type CSSProperties } from "react";
import { Button, IconArrowRight, IconExternal, Pill, SectionHeader } from "@/components/ds";
import { DealDiagram } from "./DealDiagram";
import { LandingNav } from "./LandingNav";

const ESCROW_URL =
  "https://testnet.mstscan.com/address/0x5aB34fB9CFce4a442b2CA773692a7D031D173C9A#code";
const GITHUB_URL = "https://github.com/Atharvchaskar008/SAKAR";

const REASONS = [
  {
    title: "Escrow on every deal",
    text: "Your payment sits in a smart contract, never in a company's account.",
  },
  {
    title: "Deposits on both sides",
    text: "Cheat or miss a deadline, and your deposit goes to the other side.",
  },
  {
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

const TEAM_MEMBERS = [
  {
    name: "Atharv Chaskar",
    role: "Founder · Blockchain & Protocol Architecture",
    img: "/media/yQf4bsdDIbC7M7WR70YSu65y0os.png",
    href: "https://github.com/Atharvchaskar008",
    handle: "github.com/Atharvchaskar008",
  },
  {
    name: "Bhavjot Singh",
    role: "Co-founder · Frontend & Systems Design",
    img: "/media/pOKsB3QuZXFjT51gGkpeY6f6II.png",
    href: "https://github.com/bhavsingh-gpu",
    handle: "github.com/bhavsingh-gpu",
  },
  {
    name: "MST Protocol Network",
    role: "Decentralized Settlement & Validator Network",
    img: "/media/cmjlrrueqiipWw7B3nGrsSe6I64.png",
    href: "https://testnet.mstscan.com",
    handle: "testnet.mstscan.com",
  },
];

const FAQ_ITEMS = [
  {
    q: "Do I ever share my credit card number or OTP?",
    a: "Never. The cardholder places the order through their own verified account and ships to your specified address. No card credentials, CVVs, or OTPs are ever transmitted.",
  },
  {
    q: "What happens if the order is cancelled, returned, or never delivered?",
    a: "The escrow remains safely locked until the return period elapses. If the seller fails to deliver before the deadline, the smart contract automatically triggers a full refund of your escrow.",
  },
  {
    q: "What do I need to start trading on SAKAR?",
    a: "Just a phone number or an MST-compatible Web3 wallet like BridgeKey or MetaMask. SAKAR creates an embedded wallet on phone signup automatically.",
  },
  {
    q: "Why is SAKAR built on MST Blockchain?",
    a: "Your funds sit in immutable open-source code that no central company or rogue actor can confiscate. Deals settle in ~3 seconds with cryptographic auditability.",
  },
  {
    q: "Is the platform currently live on mainnet?",
    a: "SAKAR is live on the MST Testnet with test tokens (MSTC) so you can safely simulate deals end-to-end before mainnet deployment.",
  },
];

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

export function Landing() {
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const toggleFaq = (index: number) => {
    setOpenFaq(openFaq === index ? null : index);
  };

  return (
    <>
      <LandingNav />
      <main id="top">
        {/* Hero */}
        <section className="hero">
          {/* Large Right-side Halftone Angel Artwork */}
          <div className="hero-bg-art" aria-hidden="true">
            <Image
              src="/media/0w0qwEFKa288EqQq2SBotntUpbE.png"
              alt="Halftone sculpture representing SAKAR escrow"
              fill
              priority
              className="hero-art-img"
            />
          </div>

          <div className="container hero-inner">
            <div className="hero-copy stack">
              <h1 className="display">
                Their card.
                <br />
                Your discount.
              </h1>
              <p className="lead">
                Someone else holds the bank offer you need. SAKAR lets them buy for you, while your
                money waits in a smart contract until the order arrives.
              </p>
              <div className="row" style={{ gap: 12, marginTop: 8 }}>
                <Button href="/dashboard" size="lg">
                  Open app
                </Button>
                <Button href="#how" variant="outline" size="lg">
                  How it works
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Proof strip */}
        <div className="proof">
          <div className="container row-between">
            <p className="mono proof-items">
              <span>Built on MST Blockchain</span>
              <span>Contracts verified on mstscan</span>
              <span>Works with BridgeKey and MetaMask</span>
            </p>
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

        {/* Problem */}
        <section className="lsection">
          <div className="container split">
            <SectionHeader
              eyebrow="The problem"
              title="Every card hides a discount someone else needs."
              size={1}
            />
            <p className="lead split-aside">
              Bank offers, cashback and no-cost EMI are locked to a few cardholders. The buyer who
              wants the deal has no card. The cardholder has no reason to trust a stranger.
            </p>
          </div>
        </section>

        {/* Why */}
        <section className="lsection lsection-line">
          <div className="container stack" style={{ gap: 48 }}>
            <SectionHeader eyebrow="Why SAKAR" title="Trust, without the middleman." size={1} />
            <div className="grid" style={{ "--cols": 3, gap: 0 } as CSSProperties}>
              {REASONS.map((reason) => (
                <div key={reason.title} className="reason">
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
            <div className="card diagram">
              <DealDiagram />
            </div>
            <div className="grid" style={{ "--cols": 3 } as CSSProperties}>
              {LOOP.map((step) => (
                <div key={step.n} className="card step-card">
                  <span className="num step-n">{step.n}</span>
                  <h3 className="title-2">{step.title}</h3>
                  <p className="muted">{step.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Stats */}
        <section className="stats">
          <div className="container grid" style={{ "--cols": 3, gap: 0 } as CSSProperties}>
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
        </section>

        {/* Two ways */}
        <section className="lsection">
          <div className="container stack" style={{ gap: 48 }}>
            <SectionHeader
              eyebrow="Two ways to share"
              title="One flow, two kinds of rewards."
              size={1}
            />
            <div className="grid" style={{ "--cols": 2 } as CSSProperties}>
              <div className="card way">
                <Pill tone="accent">Card offers</Pill>
                <h3 className="title-2">Buy-for-you</h3>
                <p className="muted">
                  The cardholder orders in their own account and ships to you. The payout waits for
                  the return window.
                </p>
              </div>
              <div className="card way">
                <Pill>Codes and vouchers</Pill>
                <h3 className="title-2">Pass-on</h3>
                <p className="muted">
                  A shareable code is sealed on-chain and revealed only to the buyer who paid.
                </p>
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
            <div className="grid" style={{ "--cols": 3 } as CSSProperties}>
              {TIERS.map((tier) => (
                <div key={tier.name} className="card tier">
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
        <section id="team" className="arccheo-team-section">
          <div className="arccheo-team-container">
            <div className="arccheo-section-header">
              <div className="arccheo-eyebrow has-crosses">
                <span className="corner-cross corner-cross-tl" aria-hidden="true" />
                <span className="arccheo-eyebrow-text">SAKAR&apos;S TEAM</span>
              </div>
              <h2 className="arccheo-section-heading">The people behind the protocol.</h2>
              <p className="arccheo-section-lead">
                SAKAR is built by a focused team bringing together smart contract architecture,
                cryptographic security, and consumer commerce.
              </p>
            </div>

            <div className="arccheo-team-grid">
              {TEAM_MEMBERS.map((member) => (
                <div key={member.name} className="arccheo-team-card has-crosses">
                  <Crosses />
                  <div className="arccheo-team-portrait">
                    <Image
                      src={member.img}
                      alt={member.name}
                      width={440}
                      height={320}
                      className="arccheo-team-img"
                    />
                  </div>
                  <div className="arccheo-team-info">
                    <h3 className="arccheo-team-name">{member.name}</h3>
                    <p className="arccheo-team-role">{member.role}</p>
                    <a
                      href={member.href}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="arccheo-team-link"
                    >
                      {member.handle} <IconExternal />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="arccheo-faq-section" id="faq">
          <div className="arccheo-faq-container">
            <div className="arccheo-faq-grid">
              {/* Left Column: Heading and Intro */}
              <div className="arccheo-faq-left">
                <div className="arccheo-eyebrow has-crosses">
                  <span className="corner-cross corner-cross-tl" aria-hidden="true" />
                  <span className="arccheo-eyebrow-text">FREQUENTLY ASKED QUESTIONS</span>
                </div>
                <h2 className="arccheo-section-heading">The Inquiry</h2>
                <p className="arccheo-faq-subhead">
                  Answers to practical questions buyers and cardholders ask before putting escrow
                  into operation.
                </p>
              </div>

              {/* Right Column: Accordion with hairline borders */}
              <div className="arccheo-faq-right has-crosses">
                <Crosses />
                <div className="arccheo-accordion">
                  {FAQ_ITEMS.map((item, idx) => {
                    const isOpen = openFaq === idx;
                    return (
                      <div
                        key={idx}
                        className={`arccheo-accordion-item ${isOpen ? "is-open" : ""}`}
                      >
                        <button
                          type="button"
                          className="arccheo-accordion-trigger"
                          onClick={() => toggleFaq(idx)}
                          aria-expanded={isOpen}
                        >
                          <span className="arccheo-accordion-question">{item.q}</span>
                          <span className="arccheo-accordion-icon" aria-hidden="true">
                            {isOpen ? "−" : "+"}
                          </span>
                        </button>
                        {isOpen && (
                          <div className="arccheo-accordion-body">
                            <p className="arccheo-accordion-answer">{item.a}</p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Closing CTA */}
        <section className="arccheo-cta-section">
          <div className="arccheo-cta-art" aria-hidden="true">
            <Image
              src="/arccheo/Gin5w9Fy7PmtsSiAcRhgvL7X3T4.png"
              alt=""
              fill
              className="arccheo-cta-img"
            />
          </div>

          <div className="arccheo-cta-container">
            <div className="arccheo-cta-card has-crosses">
              <Crosses />

              <div className="arccheo-eyebrow has-crosses">
                <span className="corner-cross corner-cross-tl" aria-hidden="true" />
                <span className="arccheo-eyebrow-text">BEGIN WITH SAKAR</span>
              </div>

              <h2 className="arccheo-cta-heading">Put card rewards into motion.</h2>

              <p className="arccheo-cta-lead">
                Trade credit card offers with autonomous smart contract escrow—without middleman
                counterparty risk.
              </p>

              <div className="arccheo-cta-actions">
                <Button href="/dashboard" size="lg">
                  Open app
                </Button>
                <Button href="/explore" variant="outline" size="lg">
                  Explore offers <IconArrowRight />
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Architectural Footer */}
      <footer className="arccheo-footer">
        <div className="arccheo-footer-container">
          <div className="arccheo-footer-top has-crosses">
            <Crosses />

            {/* Left Column: Brand & Bio */}
            <div className="arccheo-footer-brand">
              <Link href="/" className="arccheo-footer-logo">
                SAKAR
              </Link>
              <p className="arccheo-footer-desc">
                Card offers for everyone, settled by smart contracts on MST Blockchain.
              </p>
              <span className="arccheo-footer-copy">
                © 2026 SAKAR Protocol. All rights reserved.
              </span>
            </div>

            {/* Right 3 Navigation Columns */}
            <div className="arccheo-footer-nav">
              <div className="arccheo-footer-col">
                <h4 className="arccheo-footer-col-title">Platform</h4>
                <Link href="/explore" className="arccheo-footer-link">
                  Explore offers
                </Link>
                <Link href="/listings/new" className="arccheo-footer-link">
                  Share an offer
                </Link>
                <Link href="/deals" className="arccheo-footer-link">
                  My deals
                </Link>
                <Link href="/wallet" className="arccheo-footer-link">
                  Wallet profile
                </Link>
              </div>

              <div className="arccheo-footer-col">
                <h4 className="arccheo-footer-col-title">Protocol</h4>
                <a
                  href={GITHUB_URL}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="arccheo-footer-link"
                >
                  GitHub
                </a>
                <a
                  href={ESCROW_URL}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="arccheo-footer-link"
                >
                  Smart Contracts
                </a>
                <a
                  href="https://testnet.mstscan.com"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="arccheo-footer-link"
                >
                  MST Explorer
                </a>
                <a
                  href={`${GITHUB_URL}/blob/main/.github/SECURITY.md`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="arccheo-footer-link"
                >
                  Security
                </a>
              </div>

              <div className="arccheo-footer-col">
                <h4 className="arccheo-footer-col-title">Legal</h4>
                <Link href="/terms" className="arccheo-footer-link">
                  Terms of Service
                </Link>
                <Link href="/terms" className="arccheo-footer-link">
                  Privacy Policy
                </Link>
              </div>
            </div>
          </div>

          <div className="arccheo-footer-bottom">
            <span>© 2026 SAKAR · Built on MST Blockchain</span>
            <span>Designed by Atharv Chaskar</span>
          </div>
        </div>
      </footer>
    </>
  );
}
