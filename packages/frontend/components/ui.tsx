"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { userMessage, type Money as MoneyValue } from "@/src/client/sdk";
import { useSession } from "@/app/providers";

/** Deliberately plain building blocks; the UI teammate restyles them. */

export function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return <section className="card">{children}</section>;
}

/** "X MSTC (≈ ₹Y)", the money format used everywhere. */
export function Money({ value }: { value: MoneyValue }) {
  return (
    <span className="money">
      {value.mstc} MSTC <span className="muted">(≈ ₹{value.inr.toLocaleString("en-IN")})</span>
    </span>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p className="error" role="alert">
      {userMessage(error)}
    </p>
  );
}

export function ExplorerLink({
  href,
  children,
}: {
  href: string | null | undefined;
  children: ReactNode;
}) {
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  );
}

export function Banner({ children }: { children: ReactNode }) {
  return <p className="banner">{children}</p>;
}

/** Shows children only to signed-in users; otherwise a link to /login. */
export function RequireSignIn({ children }: { children: ReactNode }) {
  const { ready, user } = useSession();
  if (!ready) return <p className="muted">Loading…</p>;
  if (!user) {
    return (
      <p>
        Please <Link href="/login">sign in with your phone</Link> first.
      </p>
    );
  }
  return <>{children}</>;
}
