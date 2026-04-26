/**
 * Server-rendered cards for the analytics dashboard. The chart bits
 * (sparklines, big chart) live in `analytics-charts.tsx` because
 * recharts requires the client. Everything here is plain markup.
 */

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Globe2, Minus } from "lucide-react";
import type {
  CountryRow,
  DeviceRow,
  RecentVisitorRow,
  ReferrerRow,
} from "@/lib/analytics";
import { cn } from "@/lib/utils";
import {
  countryFlag,
  countryName,
  faviconUrl,
  formatCount,
  prettyReferrer,
  relativeTime,
} from "./format";
import { SparklineMini } from "./analytics-charts";

// ─── Section card wrapper ─────────────────────────────────────────

export function SectionCard({
  title,
  subtitle,
  children,
  action,
  className,
  variant = "default",
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  variant?: "default" | "accent";
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border bg-card/40 p-4 sm:p-5 gs-enter",
        variant === "accent"
          ? "gs-accent-surface"
          : "border-border/40",
        className,
      )}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-semibold leading-tight">{title}</h3>
          {subtitle ? (
            <p className="mt-0.5 text-[11.5px] text-muted-foreground leading-tight">
              {subtitle}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </div>
  );
}

// ─── KPI card with sparkline ──────────────────────────────────────

export function KpiCard({
  label,
  value,
  deltaPct,
  sparkline,
  hint,
  variant = "default",
}: {
  label: string;
  value: number;
  deltaPct?: number | null;
  sparkline?: { x: number; value: number }[];
  hint?: string;
  variant?: "default" | "accent";
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border p-4 gs-enter",
        variant === "accent"
          ? "gs-accent-surface"
          : "border-border/40 bg-card/40",
      )}
    >
      <div className="text-[11.5px] font-medium uppercase tracking-wider text-muted-foreground/80">
        {label}
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-2">
        <span className="text-[28px] sm:text-[32px] font-semibold leading-none tabular-nums tracking-tight">
          {formatCount(value)}
        </span>
        {deltaPct !== undefined ? <DeltaBadge pct={deltaPct} /> : null}
      </div>
      {hint ? (
        <div className="mt-1.5 text-[11.5px] text-muted-foreground">{hint}</div>
      ) : null}
      {sparkline && sparkline.length > 0 ? (
        <div className="mt-3">
          <SparklineMini
            data={sparkline}
            color={
              variant === "accent"
                ? "var(--gradient-primary)"
                : "var(--gradient-primary)"
            }
          />
        </div>
      ) : null}
    </div>
  );
}

function DeltaBadge({ pct }: { pct: number | null }) {
  if (pct === null) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground tabular-nums">
        <Minus className="size-3" strokeWidth={2.5} />
        new
      </span>
    );
  }
  const isUp = pct >= 0;
  const Icon = isUp ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10.5px] font-medium tabular-nums",
        isUp
          ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400"
          : "bg-red-500/12 text-red-700 dark:text-red-400",
      )}
    >
      <Icon className="size-3" strokeWidth={2.5} />
      {isUp ? "+" : ""}
      {pct}%
    </span>
  );
}

// ─── Live ticker ──────────────────────────────────────────────────

export function LiveTicker({
  todayViews,
  lastVisitor,
}: {
  todayViews: number;
  lastVisitor: RecentVisitorRow | null;
}) {
  const place = lastVisitor
    ? [lastVisitor.city, lastVisitor.country]
        .filter(Boolean)
        .join(", ") || "somewhere"
    : null;
  return (
    <div className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 rounded-full border border-border/50 bg-card/60 px-3 py-1.5 text-[11.5px] text-muted-foreground backdrop-blur-sm">
      <span className="inline-flex items-center gap-1.5 text-foreground">
        <span className="relative flex size-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-50" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
        <span className="font-medium">Live</span>
      </span>
      <span>
        <span className="text-foreground tabular-nums font-medium">
          +{todayViews}
        </span>{" "}
        today
      </span>
      {lastVisitor ? (
        <span>
          last view{" "}
          <span className="text-foreground">
            {relativeTime(lastVisitor.ts)}
          </span>{" "}
          from {countryFlag(lastVisitor.country)} {place}
        </span>
      ) : null}
    </div>
  );
}

// ─── Top referrers ────────────────────────────────────────────────

export function ReferrersList({ rows }: { rows: ReferrerRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyHint>
        Most visitors are coming directly. Share your URL on LinkedIn or
        Twitter to see sources here.
      </EmptyHint>
    );
  }
  const total = rows.reduce((acc, r) => acc + r.views, 0);
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((r) => {
        const pct = Math.round((r.views / total) * 100);
        return (
          <li key={r.host}>
            <RankRow
              leading={
                <span className="flex size-5 items-center justify-center overflow-hidden rounded-md bg-muted/40 ring-1 ring-border/40">
                  <img
                    src={faviconUrl(r.host)}
                    alt=""
                    width={16}
                    height={16}
                    className="size-3.5 object-contain"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                </span>
              }
              label={prettyReferrer(r.host)}
              sublabel={r.host}
              value={r.views}
              pct={pct}
            />
          </li>
        );
      })}
    </ul>
  );
}

// ─── Top countries ────────────────────────────────────────────────

export function CountriesList({ rows }: { rows: CountryRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyHint>
        We&apos;ll show where visitors are reading from once traffic comes
        in.
      </EmptyHint>
    );
  }
  const total = rows.reduce((acc, r) => acc + r.views, 0);
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((r) => {
        const pct = Math.round((r.views / total) * 100);
        return (
          <li key={r.country}>
            <RankRow
              leading={
                <span className="text-base leading-none">
                  {countryFlag(r.country)}
                </span>
              }
              label={countryName(r.country)}
              sublabel={`${r.uniques} unique`}
              value={r.views}
              pct={pct}
            />
          </li>
        );
      })}
    </ul>
  );
}

// ─── Devices ──────────────────────────────────────────────────────

const DEVICE_LABEL: Record<string, string> = {
  desktop: "Desktop",
  mobile: "Mobile",
  tablet: "Tablet",
  bot: "Bots",
};

export function DevicesList({ rows }: { rows: DeviceRow[] }) {
  const filtered = rows.filter((r) => r.device !== "bot");
  if (filtered.length === 0) return <EmptyHint>No data yet.</EmptyHint>;
  const total = filtered.reduce((acc, r) => acc + r.views, 0);
  return (
    <ul className="flex flex-col gap-1.5">
      {filtered.map((r) => {
        const pct = Math.round((r.views / total) * 100);
        return (
          <li key={r.device}>
            <RankRow
              leading={
                <span className="flex size-5 items-center justify-center rounded-md bg-muted/40 text-[10px] uppercase font-medium">
                  {(DEVICE_LABEL[r.device] ?? r.device)?.[0]}
                </span>
              }
              label={DEVICE_LABEL[r.device] ?? r.device}
              value={r.views}
              pct={pct}
            />
          </li>
        );
      })}
    </ul>
  );
}

// ─── Recent activity feed ─────────────────────────────────────────

export function RecentActivity({ rows }: { rows: RecentVisitorRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyHint>
        No visitors yet. Once your portfolio gets a hit you&apos;ll see
        the source, country, and device here.
      </EmptyHint>
    );
  }
  return (
    <ul className="divide-y divide-border/30 -my-1">
      {rows.map((r, i) => (
        <li key={i} className="py-2.5 flex items-start gap-3">
          <span className="mt-0.5 inline-flex size-7 items-center justify-center rounded-lg bg-muted/40 text-[14px]">
            {countryFlag(r.country)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[12.5px] leading-tight">
              <span className="font-medium truncate">
                {[r.city, countryName(r.country)].filter(Boolean).join(", ") ||
                  "Unknown location"}
              </span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-muted-foreground">
              <span>{relativeTime(r.ts)}</span>
              {r.referrer_host ? (
                <>
                  <Dot />
                  <span>via {prettyReferrer(r.referrer_host)}</span>
                </>
              ) : (
                <>
                  <Dot />
                  <span>direct</span>
                </>
              )}
              {r.device && r.device !== "desktop" ? (
                <>
                  <Dot />
                  <span>{r.device}</span>
                </>
              ) : null}
              {r.browser && r.browser !== "Other" ? (
                <>
                  <Dot />
                  <span>{r.browser}</span>
                </>
              ) : null}
            </div>
          </div>
          {r.path ? (
            <Link
              href={r.path}
              target="_blank"
              rel="noreferrer"
              className="hidden sm:inline-flex shrink-0 self-center items-center gap-1 rounded-md border border-border/40 bg-background/60 px-2 py-0.5 text-[10.5px] text-muted-foreground hover:bg-background hover:text-foreground transition-colors"
            >
              {r.path.replace(/^\//, "/").slice(0, 32)}
            </Link>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

// ─── Internals ────────────────────────────────────────────────────

function RankRow({
  leading,
  label,
  sublabel,
  value,
  pct,
}: {
  leading: React.ReactNode;
  label: string;
  sublabel?: string;
  value: number;
  pct: number;
}) {
  return (
    <div className="group relative">
      <div
        className="absolute inset-y-0 left-0 rounded-md bg-foreground/[0.045] dark:bg-foreground/[0.06]"
        style={{ width: `${Math.max(2, pct)}%` }}
      />
      <div className="relative flex items-center gap-2.5 px-2 py-1.5">
        <span className="shrink-0">{leading}</span>
        <div className="flex-1 min-w-0 flex items-baseline gap-2 overflow-hidden">
          <span className="truncate text-[12.5px] font-medium">{label}</span>
          {sublabel ? (
            <span className="hidden sm:inline truncate text-[11px] text-muted-foreground">
              {sublabel}
            </span>
          ) : null}
        </div>
        <span className="shrink-0 text-[12px] font-medium tabular-nums">
          {formatCount(value)}
        </span>
        <span className="shrink-0 w-9 text-right text-[10.5px] text-muted-foreground tabular-nums">
          {pct}%
        </span>
      </div>
    </div>
  );
}

function Dot() {
  return <span className="text-muted-foreground/50">·</span>;
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-border/40 bg-muted/20 px-3 py-2.5 text-[12px] text-muted-foreground">
      <Globe2 className="size-3.5 shrink-0" strokeWidth={2} />
      <span>{children}</span>
    </div>
  );
}
