"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ds";

const NAV_LINKS = [
  { href: "#architecture", label: "Architecture" },
  { href: "#process", label: "Sequence" },
  { href: "#team", label: "Team" },
  { href: "#faq", label: "Inquiry" },
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
    <header className="arccheo-header-wrapper">
      <div className="arccheo-nav-container">
        <div className="arccheo-nav has-crosses" data-scrolled={scrolled || open}>
          {/* Arccheo signature corner crosses */}
          <span className="corner-cross corner-cross-tl" aria-hidden="true" />
          <span className="corner-cross corner-cross-tr" aria-hidden="true" />
          <span className="corner-cross corner-cross-bl" aria-hidden="true" />
          <span className="corner-cross corner-cross-br" aria-hidden="true" />

          <div className="arccheo-nav-inner">
            {/* Wordmark logo */}
            <div className="arccheo-nav-left">
              <Link href="/" className="arccheo-logo" aria-label="SAKAR home">
                SAKAR
              </Link>
            </div>

            {/* Menu Links */}
            <nav className="arccheo-nav-menu" aria-label="Primary Navigation">
              {NAV_LINKS.map((link) => (
                <a key={link.href} href={link.href} className="arccheo-nav-link">
                  {link.label}
                </a>
              ))}
            </nav>

            {/* Actions */}
            <div className="arccheo-nav-right">
              <Button href="/dashboard" size="sm" className="arccheo-btn-primary-small">
                Open app
              </Button>
              <button
                type="button"
                className="arccheo-nav-toggle"
                aria-expanded={open}
                aria-controls="arccheo-mobile-menu"
                onClick={() => setOpen((value) => !value)}
              >
                <span className="sr-only">Toggle navigation menu</span>
                <span className="toggle-bar" aria-hidden="true" />
                <span className="toggle-bar" aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Mobile Overlay Menu */}
          {open && (
            <nav id="arccheo-mobile-menu" className="arccheo-nav-mobile" aria-label="Mobile Navigation">
              {NAV_LINKS.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="arccheo-nav-mobile-item"
                  onClick={() => setOpen(false)}
                >
                  {link.label}
                </a>
              ))}
              <div className="arccheo-nav-mobile-cta">
                <Button href="/dashboard" size="sm" className="arccheo-btn-primary-small" style={{ width: "100%" }}>
                  Open app
                </Button>
              </div>
            </nav>
          )}
        </div>
      </div>
    </header>
  );
}
