"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ds";

const LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#trust", label: "Trust" },
  { href: "#team", label: "Team" },
  { href: "#faq", label: "FAQ" },
];

export function LandingNav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="lnav-wrapper">
      <div className="container lnav-container">
        <div className="lnav has-crosses" data-scrolled={scrolled || open}>
          {/* Arccheo signature corner crosses */}
          <span className="corner-cross corner-cross-tl" aria-hidden="true" />
          <span className="corner-cross corner-cross-tr" aria-hidden="true" />
          <span className="corner-cross corner-cross-bl" aria-hidden="true" />
          <span className="corner-cross corner-cross-br" aria-hidden="true" />

          <div className="lnav-inner">
            <div className="row" style={{ gap: 10, alignItems: "center" }}>
              <Link href="/" className="wordmark" aria-label="SAKAR home">
                SAKAR
              </Link>
              <span className="lnav-status-dot" title="MST Mainnet Live" />
            </div>

            <nav className="lnav-links" aria-label="Sections">
              {LINKS.map((link) => (
                <a key={link.href} href={link.href} className="lnav-link">
                  {link.label}
                </a>
              ))}
            </nav>

            <div className="row" style={{ gap: 8, alignItems: "center" }}>
              <Button href="/dashboard" size="sm" className="lnav-cta">
                Open app
              </Button>
              <button
                type="button"
                className="lnav-toggle"
                aria-expanded={open}
                aria-controls="lnav-menu"
                onClick={() => setOpen((value) => !value)}
              >
                <span className="sr-only">Menu</span>
                <span aria-hidden="true" />
                <span aria-hidden="true" />
              </button>
            </div>
          </div>

          {open && (
            <nav id="lnav-menu" className="lnav-menu" aria-label="Sections">
              {LINKS.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="lnav-menu-item"
                  onClick={() => setOpen(false)}
                >
                  {link.label}
                </a>
              ))}
            </nav>
          )}
        </div>
      </div>
    </header>
  );
}
