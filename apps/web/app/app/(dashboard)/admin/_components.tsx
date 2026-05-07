/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import {
  ArrowUpRight01Icon,
} from "@hugeicons/core-free-icons";
import { Icon } from "@/components/dashboard/icon";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/components/dashboard/format";

/**
 * Shared visual primitives for the admin panel.
 *
 * Pulls the same look as the analytics dashboard (subtle hairline +
 * bg-card/60 surfaces, tabular-nums, ease-150 hover) so the operator
 * surface doesn't feel like a different app — it's the same chrome,
 * just with cross-user data.
 */

export function AdminCard({
  title,
  subtitle,
  action,
  children,
  className,
}: {
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border/50 bg-card/60 p-5",
        className,
      )}
    >
      {title || subtitle || action ? (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title ? (
              <h3 className="text-[13px] font-semibold leading-tight tracking-tight">
                {title}
              </h3>
            ) : null}
            {subtitle ? (
              <p className="mt-1 text-[11.5px] text-muted-foreground/80 leading-tight">
                {subtitle}
              </p>
            ) : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-border/50 bg-card/60 p-4">
      <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground/70">
        {label}
      </div>
      <div className="mt-3 text-[26px] font-semibold leading-none tabular-nums tracking-tight">
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      {hint ? (
        <div className="mt-1.5 text-[11px] text-muted-foreground/80">
          {hint}
        </div>
      ) : null}
    </div>
  );
}

export type StatusKind =
  | "succeeded"
  | "running"
  | "queued"
  | "failed"
  | "cancelled"
  | "draft"
  | "published"
  | "free"
  | "pro"
  | "neutral";

const STATUS_STYLES: Record<StatusKind, string> = {
  succeeded: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  published: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  pro:       "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  running:   "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  queued:    "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  draft:     "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  failed:    "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
  cancelled: "bg-foreground/[0.06] text-muted-foreground border-border/40",
  free:      "bg-foreground/[0.06] text-muted-foreground border-border/40",
  neutral:   "bg-foreground/[0.06] text-muted-foreground border-border/40",
};

export function StatusPill({
  kind,
  label,
}: {
  kind: StatusKind;
  label: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5",
        "text-[10.5px] font-medium uppercase tracking-[0.04em] leading-none",
        STATUS_STYLES[kind],
      )}
    >
      {kind === "running" || kind === "queued" ? (
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex h-full w-full motion-safe:animate-ping rounded-full bg-current opacity-50" />
          <span className="relative inline-flex size-1.5 rounded-full bg-current" />
        </span>
      ) : null}
      {label}
    </span>
  );
}

export function scanStatusKind(status: string | null | undefined): StatusKind {
  switch (status) {
    case "succeeded":
      return "succeeded";
    case "running":
      return "running";
    case "queued":
      return "queued";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    default:
      return "neutral";
  }
}

export function profileStatusFor(opts: {
  isPublished: boolean;
  hasScan: boolean;
  scanStatus: string | null;
}): { kind: StatusKind; label: string } {
  if (opts.isPublished) return { kind: "published", label: "Published" };
  if (opts.scanStatus === "running" || opts.scanStatus === "queued") {
    return { kind: opts.scanStatus, label: "Scanning" };
  }
  if (opts.scanStatus === "failed") return { kind: "failed", label: "Scan failed" };
  if (opts.scanStatus === "succeeded") return { kind: "draft", label: "Draft ready" };
  if (opts.hasScan) return { kind: "neutral", label: "No active scan" };
  return { kind: "neutral", label: "No scan yet" };
}

export function planKindFor(opts: {
  status: string | null;
  periodEnd: number | null;
}): { kind: StatusKind; label: string } {
  const live =
    opts.status &&
    ["active", "cancelled", "on_hold"].includes(opts.status) &&
    (opts.periodEnd ?? 0) > Date.now();
  if (live && opts.status === "active") return { kind: "pro", label: "Pro" };
  if (live && opts.status === "cancelled") return { kind: "pro", label: "Pro · cancelling" };
  if (live && opts.status === "on_hold") return { kind: "pro", label: "Pro · on hold" };
  if (opts.status === "cancelled") return { kind: "free", label: "Free · past Pro" };
  return { kind: "free", label: "Free" };
}

export function HandleAvatar({
  url,
  login,
  size = 28,
}: {
  url?: string | null;
  login?: string | null;
  size?: number;
}) {
  const dim = `${size}px`;
  if (url) {
    return (
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        style={{ width: dim, height: dim }}
        className="rounded-full object-cover ring-1 ring-border/40"
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <div
      style={{ width: dim, height: dim }}
      className="grid place-items-center rounded-full bg-foreground text-background text-[11px] font-semibold uppercase"
    >
      {(login?.[0] ?? "g").toUpperCase()}
    </div>
  );
}

export function MutedExternalLink({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "inline-flex items-center gap-0.5 text-foreground/90 hover:underline underline-offset-2",
        className,
      )}
    >
      {children}
      <Icon icon={ArrowUpRight01Icon} className="size-3" />
    </a>
  );
}

export function TimeStamp({ ts }: { ts: number | null | undefined }) {
  if (!ts) return <span className="text-muted-foreground/70">—</span>;
  return (
    <time
      dateTime={new Date(ts).toISOString()}
      title={new Date(ts).toLocaleString()}
      className="tabular-nums"
    >
      {relativeTime(ts)}
    </time>
  );
}

export function AdminBackLink({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground",
        "transition-colors duration-[120ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
      )}
    >
      <span className="-ml-0.5">←</span>
      {label}
    </Link>
  );
}

export function durationLabel(
  start: number | null,
  end: number | null,
): string {
  if (!start) return "—";
  const stop = end ?? Date.now();
  const ms = stop - start;
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return `${m}m ${r}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
