"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/explore", label: "Explore" },
  { href: "/listings/new", label: "Share" },
  { href: "/deals", label: "Deals" },
  { href: "/wallet", label: "Wallet" },
];

/** Explore · Share · Deals · Wallet */
export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="bottom-nav" aria-label="Main">
      {ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={pathname?.startsWith(item.href) ? "active" : ""}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
