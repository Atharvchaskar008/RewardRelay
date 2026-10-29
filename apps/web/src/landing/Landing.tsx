"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { Button, IconArrowRight, IconExternal } from "@/components/ds";
import { LandingNav } from "./LandingNav";

const ESCROW_URL =
  "https://testnet.mstscan.com/address/0x5aB34fB9CFce4a442b2CA773692a7D031D173C9A#code";
const GITHUB_URL = "https://github.com/Atharvchaskar008/SAKAR";

const CLIENT_LOGOS = [
  { src: "/arccheo/aO7VZrPNpr17rAk31OBOjUvQtM.svg", alt: "BridgeKey", width: 70, height: 26 },
  { src: "/arccheo/hq51MC556sUgci2Mvg5s7IwaM0Y.svg", alt: "MetaMask", width: 49, height: 27 },
  { src: "/arccheo/WCnJFcqKv9UbCn8e5O52hdSAsQ.svg", alt: "MST Blockchain", width: 71, height: 35 },
  { src: "/arccheo/z6EBk7dLA0ZVoVacv6B4xfm0fE.svg", alt: "mstscan", width: 62, height: 20 },
  { src: "/arccheo/MRHNNHDft7Fh5o3vrh3PttRsj78.svg", alt: "Web3Auth", width: 75, height: 12 },
  { src: "/arccheo/TqmEAJjy2WZmk2NT4h7NLKzDg.svg", alt: "MST Token", width: 67, height: 31 },
];

const ARCHITECTURE_CARDS = [
  {
    step: "01 · Observe",
    action: "Observe",
    title: "List the offer",
    img: "/arccheo/gxCnqw18lajATdEzbHQtI9Ud4c.png",
    text: "Cardholders post bank offers and lock their collateral deposit directly into the escrow smart contract. Zero custodial middleman.",
  },
  {
    step: "02 · Reason",
    action: "Reason",
    title: "Lock the escrow",
    img: "/arccheo/2kfLIBd1mfhRBldMqHLvDwR0tY.png",
    text: "The buyer pays the deal amount into public escrow code. Funds sit immutably on MST Blockchain where nobody can touch them.",
  },
  {
    step: "03 · Move",
    action: "Move",
    title: "Release payout",
    img: "/arccheo/JADFdcxbz48BnZzsgn2XAqvvYoE.png",
    text: "Order delivered and verified? The smart contract automatically releases the payout to the cardholder and refunds all security deposits.",
  },
];

const SEQUENCE_PHASES = [
  {
    phase: "Phase I",
    title: "Direct Merchant Order",
    text: "The cardholder orders in their own verified account using their bank offer and ships directly to the buyer's delivery address.",
  },
  {
    phase: "Phase II",
    title: "Sealed Digital Voucher",
    text: "Instant coupons, gift cards, and promotional codes are sealed on-chain and revealed exclusively to the buyer who locked escrow.",
  },
  {
    phase: "Phase III",
    title: "On-chain Reputation",
    text: "Every completed transaction builds soulbound trust on MST Blockchain, reducing collateral requirements from 50% down to 20%.",
  },
];

const TEAM_MEMBERS = [
  {
    name: "Atharv Chaskar",
    role: "Founder · Blockchain & Protocol Architecture",
    img: "/arccheo/yQf4bsdDIbC7M7WR70YSu65y0os.png",
    href: "https://github.com/Atharvchaskar008",
    handle: "github.com/Atharvchaskar008",
  },
  {
    name: "Bhavjot Singh",
    role: "Co-founder · Frontend & Systems Design",
    img: "/arccheo/pOKsB3QuZXFjT51gGkpeY6f6II.png",
    href: "https://github.com/bhavsingh-gpu",
    handle: "github.com/bhavsingh-gpu",
  },
  {
    name: "MST Protocol Network",
    role: "Decentralized Settlement & Validator Network",
    img: "/arccheo/cmjlrrueqiipWw7B3nGrsSe6I64.png",
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

/** 4 Corner crosses matching the Arccheo architectural visual style */
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
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const toggleFaq = (index: number) => {
    setOpenFaq(openFaq === index ? null : index);
  };

  return (
    <div className="arccheo-root">
      <LandingNav />

      {/* Main 1440px container with dashed side guides */}
      <main id="top" className="arccheo-main-frame">
        {/* =================================================================
            1. HERO SECTION
            ================================================================= */}
        <section className="arccheo-hero-section" id="hero">
          {/* Halftone 3D angel sculpture background artwork */}
          <div className="arccheo-hero-art" aria-hidden="true">
            <Image
              src="/arccheo/0w0qwEFKa288EqQq2SBotntUpbE.png"
              alt=""
              fill
              priority
              className="arccheo-hero-art-img"
            />
          </div>

          <div className="arccheo-hero-container">
            <div className="arccheo-hero-card has-crosses">
              <Crosses />

              {/* Eyebrow with top-left cross */}
              <div className="arccheo-eyebrow has-crosses">
                <span className="corner-cross corner-cross-tl" aria-hidden="true" />
                <span className="arccheo-eyebrow-text">
                  ESCROW INFRASTRUCTURE FOR CARD OFFERS
                </span>
              </div>

              {/* Massive Display Heading */}
              <h1 className="arccheo-hero-heading">
                Their card.
                <br />
                Built to operate.
              </h1>

              {/* Lead Paragraph */}
              <p className="arccheo-hero-lead">
                Someone else holds the bank offer you need. SAKAR gives product and trading
                workflows the autonomous escrow infrastructure to list, lock, and settle card
                rewards with complete confidence.
              </p>

              {/* Dual Action Buttons */}
              <div className="arccheo-hero-actions">
                <Button href="/dashboard" size="lg" className="arccheo-btn-primary">
                  Open app
                </Button>
                <Button
                  href="/explore"
                  variant="outline"
                  size="lg"
                  className="arccheo-btn-secondary"
                >
                  Explore offers <IconArrowRight />
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* =================================================================
            2. CLIENTS / ECOSYSTEM SECTION
            ================================================================= */}
        <section className="arccheo-clients-section" id="clients">
          <div className="arccheo-clients-backdrop" aria-hidden="true">
            <Image
              src="/arccheo/9ASpNibqqpwmGO6LIMll9Ti7fk.png"
              alt=""
              fill
              className="arccheo-clients-bg-img"
            />
          </div>

          <div className="arccheo-clients-container">
            <p className="arccheo-clients-subtitle">
              SAKAR provides the reliable escrow infrastructure needed to share, buy, and settle
              card rewards with confidence.
            </p>

            <div className="arccheo-logos-strip has-crosses">
              <Crosses />
              <div className="arccheo-logos-grid">
                {CLIENT_LOGOS.map((logo, idx) => (
                  <div key={idx} className="arccheo-logo-item">
                    <Image
                      src={logo.src}
                      alt={logo.alt}
                      width={logo.width}
                      height={logo.height}
                      className="arccheo-logo-svg"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* =================================================================
            3. MANIFESTO SECTION (THE ICONIC COBALT BLUE CARD)
            ================================================================= */}
        <section className="arccheo-manifesto-section" id="manifesto">
          <div className="arccheo-manifesto-container">
            <div className="arccheo-manifesto-grid has-crosses">
              <Crosses />

              {/* Left Column: Headline and Classical Sculpture */}
              <div className="arccheo-manifesto-left">
                <div className="arccheo-eyebrow has-crosses">
                  <span className="corner-cross corner-cross-tl" aria-hidden="true" />
                  <span className="arccheo-eyebrow-text">THE AUTONOMOUS ESCROW</span>
                </div>

                <h2 className="arccheo-manifesto-headline">
                  The next generation of card commerce will not wait for middleman approval.
                </h2>

                <div className="arccheo-manifesto-sculpture" aria-hidden="true">
                  <Image
                    src="/arccheo/P1GhJhxUrWiZsU9jGn1L1ovees0.png"
                    alt=""
                    width={320}
                    height={460}
                    className="arccheo-sculpture-img"
                  />
                </div>
              </div>

              {/* Right Column: Signature Vibrant Cobalt Blue Card */}
              <div className="arccheo-manifesto-right">
                <div className="arccheo-cobalt-card">
                  {/* Subtle Sculpture Overlays on Blue */}
                  <div className="arccheo-cobalt-art" aria-hidden="true">
                    <Image
                      src="/arccheo/zDuqYBwiwIZtairk3UsgSYAUydU.png"
                      alt=""
                      fill
                      className="arccheo-cobalt-img"
                    />
                  </div>

                  <div className="arccheo-cobalt-content">
                    {/* Big quotation glyph */}
                    <span className="arccheo-quote-mark">“</span>

                    <blockquote className="arccheo-quote-text">
                      It will lock, verify, and release. SAKAR is the foundation beneath that
                      escrow, connecting cardholders, buyers, contracts, and dispute resolution in
                      one observable system.
                    </blockquote>

                    <div className="arccheo-quote-author">
                      <span>— SAKAR PROTOCOL.</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* =================================================================
            4. OPERATIONAL SECTION (ESCROW WITHOUT THE BLACK BOX)
            ================================================================= */}
        <section className="arccheo-operational-section" id="operational">
          <div className="arccheo-operational-container">
            <div className="arccheo-operational-card has-crosses">
              <Crosses />

              <div className="arccheo-operational-top">
                <div className="arccheo-eyebrow has-crosses">
                  <span className="corner-cross corner-cross-tl" aria-hidden="true" />
                  <span className="arccheo-eyebrow-text">DEPENDABLE ESCROW</span>
                </div>

                <h2 className="arccheo-section-heading">Escrow without the black box.</h2>

                <p className="arccheo-operational-lead">
                  See how every deal is executed, define where collateral deposits are locked, and
                  intervene before uncertainty becomes risk.
                </p>

                <ul className="arccheo-bullet-list">
                  <li>— Trace every transaction live on MST Blockchain</li>
                  <li>— Set operational deposit boundaries (20% – 50%)</li>
                  <li>— Intervene through decentralized arbitration at any moment</li>
                </ul>
              </div>

              {/* Wide Architectural Diagram container */}
              <div className="arccheo-diagram-frame has-crosses">
                <Crosses />
                <Image
                  src="/arccheo/FcaoF9uIayDlJXIXgnjb7h8GY.png"
                  alt="SAKAR Architectural Escrow Execution Pipeline"
                  width={1400}
                  height={660}
                  className="arccheo-diagram-img"
                />
              </div>
            </div>
          </div>
        </section>

        {/* =================================================================
            5. ARCHITECTURE SECTION (3 SERVICES CARDS)
            ================================================================= */}
        <section className="arccheo-architecture-section" id="architecture">
          <div className="arccheo-architecture-container">
            <div className="arccheo-section-header-block">
              <div className="arccheo-eyebrow has-crosses">
                <span className="corner-cross corner-cross-tl" aria-hidden="true" />
                <span className="arccheo-eyebrow-text">SYSTEM FOUNDATION</span>
              </div>
              <h2 className="arccheo-section-heading">The architecture</h2>
              <p className="arccheo-section-subhead">
                A continuous operational loop that transforms locked deposits into guaranteed
                delivery.
              </p>
            </div>

            {/* 3 Services Cards Grid */}
            <div className="arccheo-services-grid">
              {ARCHITECTURE_CARDS.map((card, idx) => (
                <div key={idx} className="arccheo-service-card has-crosses">
                  <Crosses />

                  {/* Top Halftone Sculpture Graphic */}
                  <div className="arccheo-service-art">
                    <Image
                      src={card.img}
                      alt={card.title}
                      width={480}
                      height={320}
                      className="arccheo-service-img"
                    />
                  </div>

                  <div className="arccheo-service-body">
                    <span className="arccheo-step-badge">{card.step}</span>
                    <h3 className="arccheo-service-title">{card.title}</h3>
                    <p className="arccheo-service-text">{card.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* =================================================================
            6. PROCESS SECTION (THE SEQUENCE)
            ================================================================= */}
        <section className="arccheo-process-section" id="process">
          <div className="arccheo-process-container">
            <div className="arccheo-section-header-block">
              <div className="arccheo-eyebrow has-crosses">
                <span className="corner-cross corner-cross-tl" aria-hidden="true" />
                <span className="arccheo-eyebrow-text">FROM INTENT TO OPERATION</span>
              </div>
              <h2 className="arccheo-section-heading">The Sequence</h2>
              <p className="arccheo-section-subhead">
                Move from an unutilized card discount to a completed, dispute-free delivery.
              </p>
            </div>

            {/* 3 Phase Cards with vertical dark texture */}
            <div className="arccheo-phases-grid">
              {SEQUENCE_PHASES.map((phase, idx) => (
                <div key={idx} className="arccheo-phase-card has-crosses">
                  <Crosses />

                  <div className="arccheo-phase-bg" aria-hidden="true">
                    <Image
                      src="/arccheo/jlmiucTNtCRDOX8ajUfLn3hFc3Y.png"
                      alt=""
                      fill
                      className="arccheo-phase-bg-img"
                    />
                  </div>

                  <div className="arccheo-phase-content">
                    <div className="arccheo-phase-pill">{phase.phase}</div>
                    <h3 className="arccheo-phase-title">{phase.title}</h3>
                    <p className="arccheo-phase-desc">{phase.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* =================================================================
            7. TEAM SECTION (THE PEOPLE BEHIND THE PROTOCOL)
            ================================================================= */}
        <section className="arccheo-team-section" id="team">
          <div className="arccheo-team-container">
            <div className="arccheo-section-header-block">
              <div className="arccheo-eyebrow has-crosses">
                <span className="corner-cross corner-cross-tl" aria-hidden="true" />
                <span className="arccheo-eyebrow-text">SAKAR&apos;S TEAM</span>
              </div>
              <h2 className="arccheo-section-heading">The people behind the protocol.</h2>
              <p className="arccheo-section-subhead">
                SAKAR is built by a focused team bringing together smart contract architecture,
                cryptographic security, and consumer commerce.
              </p>
            </div>

            {/* 3 Team Cards */}
            <div className="arccheo-team-grid">
              {TEAM_MEMBERS.map((member, idx) => (
                <div key={idx} className="arccheo-team-card has-crosses">
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

        {/* =================================================================
            8. FAQ SECTION (THE INQUIRY)
            ================================================================= */}
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

        {/* =================================================================
            9. CLOSING CTA SECTION (PUT INTELLIGENCE / REWARDS INTO MOTION)
            ================================================================= */}
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
                <Button href="/dashboard" size="lg" className="arccheo-btn-primary">
                  Open app
                </Button>
                <Button
                  href="/explore"
                  variant="outline"
                  size="lg"
                  className="arccheo-btn-secondary"
                >
                  Explore offers <IconArrowRight />
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* =================================================================
          10. ARCHITECTURAL FOOTER
          ================================================================= */}
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
            <span>Designed with Arccheo Architecture System</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
