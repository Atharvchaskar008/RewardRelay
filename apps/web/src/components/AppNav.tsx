"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMe } from "@/client/sdk";
import { useSession } from "@/app/providers";
import {
  Avatar,
  Button,
  IconArrowLeft,
  IconDeals,
  IconExplore,
  IconPlus,
  IconUser,
  inr,
} from "@/components/ds";
import { PWAInstallPill } from "@/components/PWAInstallBanner";

const ITEMS = [
  { href: "/explore", label: "Explore", Icon: IconExplore },
  { href: "/listings/new", label: "Share", Icon: IconPlus },
  { href: "/deals", label: "Deals", Icon: IconDeals },
  { href: "/wallet", label: "Profile", Icon: IconUser, also: ["/profile"] },
];

function isActive(pathname: string | null, item: (typeof ITEMS)[number]) {
  if (!pathname) return false;
  return [item.href, ...(item.also ?? [])].some((href) => pathname.startsWith(href));
}

/** Balance and avatar of the signed-in user (only mounted when signed in). */
function AccountPill() {
  const me = useMe();
  if (!me.data) {
    return (
      <Link href="/login" className="topbar-account" aria-label="Finish setting up">
        <Avatar size={32} />
      </Link>
    );
  }
  return (
    <Link href="/wallet" className="topbar-account" aria-label="Profile">
      <span className="num">{inr(me.data.balanceInr)}</span>
      <Avatar address={me.data.address} size={32} />
    </Link>
  );
}

/** Desktop top bar and mobile bottom bar: Explore · Share · Deals · Profile. */
export function AppNav() {
  const pathname = usePathname();
  const { user } = useSession();

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="row" style={{ gap: 32 }}>
            <Link
              href="/"
              className="topbar-back-link"
              aria-label="Return to SAKER landing page"
              title="Return to SAKER landing page"
            >
              <IconArrowLeft />
              <span className="wordmark">SAKER</span>
            </Link>
            <nav className="topbar-nav" aria-label="Main">
              <Link href="/dashboard" aria-current={pathname === "/dashboard" ? "page" : undefined}>
                Overview
              </Link>
              {ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive(pathname, item) ? "page" : undefined}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          {user ? (
            <div className="row" style={{ gap: 8, alignItems: "center" }}>
              <PWAInstallPill />
              <AccountPill />
            </div>
          ) : pathname === "/login" ? null : (
            <div className="row" style={{ gap: 8, alignItems: "center" }}>
              <PWAInstallPill />
              <span className="pill pill-subtle" style={{ fontSize: 12, padding: "2px 8px" }}>
                Guest Mode
              </span>
              <Button href="/login" size="sm">
                Connect Wallet
              </Button>
            </div>
          )}
        </div>
      </header>

      <nav className="bottombar" aria-label="Main">
        {ITEMS.map(({ href, label, Icon, ...item }) => (
          <Link
            key={href}
            href={href}
            aria-current={isActive(pathname, { href, label, Icon, ...item }) ? "page" : undefined}
          >
            <Icon />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}
