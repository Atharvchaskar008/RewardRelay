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
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 8);
      const total = document.documentElement.scrollHeight - window.innerHeight;
      if (total > 0) {
        setProgress(Math.min(100, Math.max(0, (window.scrollY / total) * 100)));
      }
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="lnav" data-scrolled={scrolled || open}>
      <div className="lnav-progress-bar" style={{ width: `${progress}%` }} aria-hidden="true" />
      <div className="container lnav-inner">
        <Link href="/" className="wordmark" aria-label="SAKER home">
          SAKER
        </Link>
        <nav className="lnav-links" aria-label="Sections">
          {LINKS.map((link) => (
            <a key={link.href} href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>
        <div className="row" style={{ gap: 8 }}>
          <Button href="/dashboard" size="sm">
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
        <nav id="lnav-menu" className="container lnav-menu" aria-label="Sections">
          {LINKS.map((link) => (
            <a key={link.href} href={link.href} onClick={() => setOpen(false)}>
              {link.label}
            </a>
          ))}
        </nav>
      )}
    </header>
  );
}
