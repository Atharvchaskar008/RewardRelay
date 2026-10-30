"use client";

import Link from "next/link";
import { useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";
import { IconCheck, IconCopy, IconExternal } from "./icons";

export * from "./icons";

const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(" ");

/* ---------- Button ---------- */

type ButtonVariant = "primary" | "accent" | "outline" | "ghost" | "danger";

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  block?: boolean;
  loading?: boolean;
  href?: string;
  className?: string;
}

export function Button({
  variant = "primary",
  size = "md",
  block,
  loading,
  href,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  const classes = cx(
    "btn",
    `btn-${variant}`,
    size !== "md" && `btn-${size}`,
    block && "btn-block",
    className,
  );
  if (href) {
    const external = /^https?:/.test(href);
    return (
      <Link
        href={href}
        prefetch={external ? undefined : true}
        className={classes}
        {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
      >
        {children}
      </Link>
    );
  }
  return (
    <button className={classes} disabled={disabled || loading} aria-busy={loading} {...rest}>
      {loading && <span className="spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

/* ---------- Card ---------- */

export function Card({
  children,
  href,
  flat,
  className,
  style,
}: {
  children: ReactNode;
  href?: string;
  flat?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const classes = cx(flat ? "card-flat" : "card", href && "card-interactive", className);
  if (href) {
    return (
      <Link href={href} className={classes} style={style}>
        {children}
      </Link>
    );
  }
  return (
    <section className={classes} style={style}>
      {children}
    </section>
  );
}

/* ---------- Pill ---------- */

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

export function Pill({
  tone = "neutral",
  dot,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  children: ReactNode;
}) {
  return (
    <span className={cx("pill", tone !== "neutral" && `pill-${tone}`, dot && "pill-dot")}>
      {children}
    </span>
  );
}

/* ---------- Stat ---------- */

export function Stat({
  label,
  value,
  unit,
  sub,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  sub?: ReactNode;
}) {
  return (
    <div className="stat">
      <span className="label">{label}</span>
      <span className="stat-value">
        {value}
        {unit && <small>{unit}</small>}
      </span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

/* ---------- Avatar: a symmetric 5×5 pixel mark derived from the address ---------- */

function cells(seed: string): boolean[] {
  const hex = seed.toLowerCase().replace(/^0x/, "").padEnd(40, "0");
  const out: boolean[] = [];
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 3; col++) {
      const nibble = parseInt(hex[(row * 3 + col) % hex.length], 16);
      out.push(nibble % 2 === 0 || nibble > 11);
    }
  }
  return out;
}

export function Avatar({
  address,
  initials,
  size = 32,
  label,
}: {
  address?: string | null;
  initials?: string;
  size?: number;
  label?: string;
}) {
  const style = { "--size": `${size}px` } as CSSProperties;
  if (initials) {
    return (
      <span className="avatar" style={style} role="img" aria-label={label ?? initials}>
        <span className="avatar-initials">{initials}</span>
      </span>
    );
  }
  const on = cells(address ?? "");
  return (
    <span className="avatar" style={style} role="img" aria-label={label ?? "Profile"}>
      <svg viewBox="0 0 5 5" shapeRendering="crispEdges" aria-hidden="true">
        {on.map((filled, index) => {
          if (!filled || !address) return null;
          const row = Math.floor(index / 3);
          const col = index % 3;
          return [col, 4 - col]
            .filter((x, i, all) => all.indexOf(x) === i)
            .map((x) => (
              <rect key={`${row}-${x}`} x={x} y={row} width="1" height="1" fill="var(--accent)" />
            ));
        })}
      </svg>
    </span>
  );
}

/* ---------- Section header ---------- */

export function SectionHeader({
  eyebrow,
  title,
  lead,
  size = 2,
  action,
}: {
  eyebrow?: string;
  title: ReactNode;
  lead?: ReactNode;
  size?: 1 | 2 | 3;
  action?: ReactNode;
}) {
  const Heading = size === 1 ? "h1" : "h2";
  return (
    <header className="row-between" style={{ alignItems: "flex-end" }}>
      <div className="stack" style={{ "--gap": "12px" } as CSSProperties}>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <Heading className={`title-${size}`}>{title}</Heading>
        {lead && <p className="lead">{lead}</p>}
      </div>
      {action}
    </header>
  );
}

/* ---------- Stepper ---------- */

export function Stepper({
  steps,
}: {
  steps: { label: string; state: "done" | "current" | "todo" }[];
}) {
  return (
    <ol
      className="stepper"
      style={{ "--steps": steps.length, padding: 0, margin: 0, listStyle: "none" } as CSSProperties}
    >
      {steps.map((step) => (
        <li
          key={step.label}
          className="step"
          data-state={step.state}
          aria-current={step.state === "current" ? "step" : undefined}
        >
          <span className="step-bar" />
          <span className="step-label">{step.label}</span>
        </li>
      ))}
    </ol>
  );
}

/* ---------- Form field ---------- */

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <span className="field-error">{error}</span>
      ) : (
        hint && <span className="field-hint">{hint}</span>
      )}
    </div>
  );
}

/* ---------- Empty and loading states ---------- */

export function EmptyState({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <p className="muted">{title}</p>
      {action}
    </div>
  );
}

export function Skeleton({
  height = 16,
  width = "100%",
}: {
  height?: number;
  width?: number | string;
}) {
  return (
    <span className="skeleton" style={{ display: "block", height, width }} aria-hidden="true" />
  );
}

/* ---------- Address chip ---------- */

export const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label={copied ? "Copied" : label}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <IconCheck /> : <IconCopy />}
    </button>
  );
}

export function AddressChip({ address, href }: { address: string; href?: string | null }) {
  return (
    <span className="address">
      {shortAddress(address)}
      <CopyButton text={address} label="Copy address" />
      {href && (
        <a
          className="icon-btn"
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          aria-label="View on mstscan"
        >
          <IconExternal />
        </a>
      )}
    </span>
  );
}

/* ---------- Money ---------- */

export const inr = (value: number) => `₹${value.toLocaleString("en-IN")}`;

export function MoneyText({
  value,
  size = "md",
}: {
  value: { mstc: string; inr: number };
  size?: "md" | "lg";
}) {
  return (
    <span className="stack" style={{ "--gap": "2px" } as CSSProperties}>
      <span
        className={size === "lg" ? "stat-value" : "num"}
        style={size === "md" ? { fontSize: 16 } : undefined}
      >
        {inr(value.inr)}
      </span>
      <span className="stat-sub">{value.mstc} MSTC</span>
    </span>
  );
}
