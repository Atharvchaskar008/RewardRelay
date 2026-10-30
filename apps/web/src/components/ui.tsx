"use client";

import type { CSSProperties, ReactNode } from "react";
import { userMessage, type Money as MoneyValue } from "@/client/sdk";
import { useSession } from "@/app/providers";
import { Button, Card as DsCard, Pill, Skeleton, inr, type Tone } from "@/components/ds";

/** App building blocks on top of the design system (`@/components/ds`). */

export function Page({
  title,
  eyebrow,
  action,
  narrow,
  children,
}: {
  title?: ReactNode;
  eyebrow?: string;
  action?: ReactNode;
  narrow?: boolean;
  children: ReactNode;
}) {
  return (
    <main className={narrow ? "page page-narrow" : "page"}>
      {(title || eyebrow) && (
        <header className="page-head">
          <div className="stack" style={{ "--gap": "8px" } as CSSProperties}>
            {eyebrow && <span className="eyebrow">{eyebrow}</span>}
            {title && <h1 className="title-2">{title}</h1>}
          </div>
          {action}
        </header>
      )}
      {children}
    </main>
  );
}

export const Card = DsCard;

/** "₹Y · X MSTC", the money format used everywhere. */
export function Money({ value }: { value: MoneyValue }) {
  return (
    <span className="num">
      {inr(value.inr)} <span className="faint">· {value.mstc} MSTC</span>
    </span>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p className="alert alert-danger" role="alert">
      {userMessage(error)}
    </p>
  );
}

export function Banner({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "success";
}) {
  return <p className={tone === "neutral" ? "alert" : `alert alert-${tone}`}>{children}</p>;
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
    <a className="link" href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  );
}

/** Shows children only to signed-in users; otherwise one card with the way in. */
export function RequireSignIn({ children }: { children: ReactNode }) {
  const { ready, user } = useSession();
  if (!ready) return <LoadingCard />;
  if (!user) {
    return (
      <DsCard className="signin-card">
        <span className="label">Sign in</span>
        <h2 className="title-3">Sign in to continue</h2>
        <Button href="/login">Connect wallet to sign in</Button>
      </DsCard>
    );
  }
  return <>{children}</>;
}

export function LoadingCard({ lines = 3 }: { lines?: number }) {
  return (
    <DsCard>
      <div className="stack" style={{ "--gap": "12px" } as CSSProperties}>
        <Skeleton height={12} width={96} />
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} height={18} width={i === lines - 1 ? "60%" : "100%"} />
        ))}
      </div>
    </DsCard>
  );
}

/** Deal status → a short label and a pill tone. */
const STATUS: Record<string, { label: string; tone: Tone }> = {
  Listed: { label: "Open", tone: "accent" },
  Locked: { label: "Paid", tone: "warning" },
  Delivered: { label: "Delivered", tone: "warning" },
  Disputed: { label: "Disputed", tone: "danger" },
  Completed: { label: "Completed", tone: "success" },
  Resolved: { label: "Resolved", tone: "neutral" },
  Refunded: { label: "Refunded", tone: "neutral" },
  Cancelled: { label: "Cancelled", tone: "neutral" },
};

export function StatusPill({ status, label }: { status: string; label?: string }) {
  const known = STATUS[status];
  return (
    <Pill tone={known?.tone ?? "neutral"} dot>
      {known?.label ?? label ?? status}
    </Pill>
  );
}

export function isActiveStatus(status: string): boolean {
  return ["Listed", "Locked", "Delivered", "Disputed"].includes(status);
}
