"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { hashscanBase } from "@/lib/chain";
import { shorten } from "@/lib/format";
import { tinybarToHbar } from "@/lib/money";
import type { ApiError } from "@/lib/api";

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "primary";
const tones: Record<Tone, string> = {
  neutral: "bg-surface-2 text-foreground border-border",
  success: "bg-success/10 text-success border-success/30",
  warning: "bg-warning/10 text-warning border-warning/30",
  danger: "bg-danger/10 text-danger border-danger/30",
  info: "bg-info/10 text-info border-info/30",
  primary: "bg-primary/10 text-primary border-primary/30",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-lg border border-border bg-surface p-4 md:p-6 ${className}`}>{children}</section>;
}

const btn =
  "inline-flex h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
export function Button({
  variant = "primary",
  className = "",
  ...p
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  const v =
    variant === "primary"
      ? "bg-primary text-primary-foreground hover:opacity-90"
      : variant === "danger"
        ? "bg-danger text-primary-foreground hover:opacity-90"
        : "border border-border bg-surface text-foreground hover:bg-surface-2";
  return <button type="button" className={`${btn} ${v} ${className}`} {...p} />;
}
export function ButtonLink({ href, children, variant = "primary" }: { href: string; children: ReactNode; variant?: "primary" | "secondary" }) {
  const v = variant === "primary" ? "bg-primary text-primary-foreground hover:opacity-90" : "border border-border bg-surface hover:bg-surface-2";
  return (
    <Link href={href} className={`${btn} ${v}`}>
      {children}
    </Link>
  );
}

/** Tinybar string in, "1.5 HBAR" out. Bad input prints "n/a", never "0 HBAR". */
export function Hbar({ value }: { value: string | null | undefined }) {
  let text = "n/a";
  try {
    if (value != null) text = `${tinybarToHbar(value)} HBAR`;
  } catch {
    text = "n/a";
  }
  return <span className="font-mono tabular-nums">{text}</span>;
}

export function HashScanLink({ kind, value }: { kind: "tx" | "contract" | "account"; value: string | null | undefined }) {
  if (!value) return null;
  const path = kind === "tx" ? "transaction" : kind;
  return (
    <a
      className="inline-flex items-center gap-1 font-mono text-sm text-primary underline"
      href={`${hashscanBase}/${path}/${value}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`View on HashScan: ${value}`}
    >
      {shorten(value, 8, 6)} <span aria-hidden>↗</span>
      <span className="sr-only">View on HashScan</span>
    </a>
  );
}

export function ChainStatus({ state }: { state: "pending" | "confirmed" | "failed" }) {
  const map = {
    pending: { tone: "warning", icon: "…", text: "Waiting for confirmation" },
    confirmed: { tone: "success", icon: "✓", text: "Confirmed on Hedera" },
    failed: { tone: "danger", icon: "✕", text: "Transaction failed" },
  } as const;
  const m = map[state];
  return (
    <Badge tone={m.tone}>
      <span aria-hidden>{m.icon}</span> {m.text}
    </Badge>
  );
}

export const SeededBadge = () => <Badge tone="warning">Seeded demo data</Badge>;

export function VerdictBadge({ result }: { result: "PASS" | "FAIL" | "ERROR" }) {
  if (result === "PASS") return <Badge tone="success"><span aria-hidden>✓</span> PASS</Badge>;
  if (result === "FAIL") return <Badge tone="danger"><span aria-hidden>✕</span> FAIL</Badge>;
  return <Badge tone="warning"><span aria-hidden>!</span> Verification error, not a fail</Badge>;
}

export const AUDIT_TEXT = "Automated verification is not a professional audit.";
export const AuditNotice = ({ text = AUDIT_TEXT }: { text?: string }) => (
  <p className="text-sm text-muted-foreground">
    <span aria-hidden>🛡 </span>
    {text}
  </p>
);

export function Alert({ tone = "info", title, children }: { tone?: Tone; title?: string; children?: ReactNode }) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={`rounded-lg border p-4 text-sm ${tones[tone]}`}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={title ? "mt-1" : ""}>{children}</div>}
    </div>
  );
}

export function ErrorPanel({ title = "Something went wrong", detail, onRetry }: { title?: string; detail?: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
      <p className="font-semibold">{title}</p>
      <p className="mt-1">Something on our side failed. Your funds are not affected. Try again.</p>
      {detail && <p className="mt-1 break-words font-mono text-xs">{detail}</p>}
      {onRetry && (
        <Button variant="secondary" className="mt-3" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

/** Maps an API error to the right panel: 404, 409/other inline, infra with retry. */
export function QueryError({ error, onRetry, title }: { error: unknown; onRetry?: () => void; title?: string }) {
  const e = error as ApiError;
  if (e && typeof e.status === "number" && !e.isInfra) {
    return <Alert tone="warning" title={title}>{e.message}</Alert>;
  }
  return <ErrorPanel title={title} detail={e?.message} onRetry={onRetry} />;
}

export function EmptyState({ title, body, action, pageHeading = false }: { title: string; body?: string; action?: ReactNode; pageHeading?: boolean }) {
  const Title = pageHeading ? "h1" : "p";
  return (
    <div className="rounded-lg border border-dashed border-border p-8 text-center">
      <Title className="font-medium">{title}</Title>
      {body && <p className="mt-1 text-sm text-muted-foreground">{body}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export const Skeleton = ({ className = "h-6 w-full" }: { className?: string }) => (
  <div className={`animate-pulse rounded-md bg-surface-2 ${className}`} aria-hidden />
);
export function PageSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="space-y-4">
      <h1 className="sr-only">Loading</h1>
      <Skeleton className="h-8 w-1/2" />
      <Skeleton className="h-32" />
      <Skeleton className="h-32" />
    </div>
  );
}

export function Mono({ children }: { children: ReactNode }) {
  return <span className="break-all font-mono text-sm tabular-nums">{children}</span>;
}

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  return (
    <button
      type="button"
      className="rounded-md border border-border px-2 py-1 text-xs hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring"
      aria-label={`${label} ${value}`}
      onClick={() => void navigator.clipboard?.writeText(value).catch(() => undefined)}
    >
      {label}
    </button>
  );
}

export function Field({ label, id, hint, error, children }: { label: string; id: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p id={`${id}-err`} role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
export const inputCls =
  "block w-full rounded-lg border border-border bg-surface px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export function Loading({ text }: { text: string }) {
  return (
    <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
      {text}
    </p>
  );
}
