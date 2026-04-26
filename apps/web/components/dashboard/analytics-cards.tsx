/* eslint-disable @next/next/no-img-element */

/**
 * Server-rendered cards for the analytics dashboard.
 *
 * Visual rules (post design pass):
 *   - One uniform card style: subtle bg + 1px hairline border. No
 *     gradient hero card — uniformity reads more premium than a
 *     special-snowflake first card.
 *   - Tabular nums for every changing number (Emil — no layout shift).
 *   - Hover: ease 150ms, single property (bg-color), never `transition-all`.
 *   - Mount animations stripped — users hit this page every visit.
 */

import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Globe2 } from "lucide-react";
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
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border/50 bg-card/60 p-5",
        className,
      )}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-semibold leading-tight tracking-tight">
            {title}
          </h3>
          {subtitle ? (
            <p className="mt-1 text-[11.5px] text-muted-foreground/80 leading-tight">
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
}: {
  label: string;
  value: number;
  deltaPct?: number | null;
  sparkline?: { x: number; value: number }[];
  hint?: string;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-border/50 bg-card/60 p-5",
        "transition-[background-color] duration-150 ease",
        "hover:bg-card",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground/70">
          {label}
        </span>
        {deltaPct !== undefined && deltaPct !== null ? (
          <DeltaBadge pct={deltaPct} />
        ) : null}
      </div>
      <div className="mt-3 flex items-baseline gap-1">
        <span className="text-[30px] font-semibold leading-none tabular-nums tracking-tight">
          {formatCount(value)}
        </span>
      </div>
      {hint ? (
        <div className="mt-1.5 text-[11.5px] text-muted-foreground/70">
          {hint}
        </div>
      ) : null}
      {sparkline && sparkline.length > 0 ? (
        <div className="mt-4 -mx-1">
          <SparklineMini data={sparkline} />
        </div>
      ) : (
        // Hold the same vertical footprint so cards align even when
        // some don't have a sparkline. Emil: no layout shift.
        <div className="mt-4 h-9" aria-hidden />
      )}
    </div>
  );
}

function DeltaBadge({ pct }: { pct: number }) {
  if (pct === 0) {
    return (
      <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10.5px] font-medium tabular-nums text-muted-foreground/70">
        —
      </span>
    );
  }
  const isUp = pct > 0;
  const Icon = isUp ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10.5px] font-medium tabular-nums",
        isUp
          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          : "bg-red-500/10 text-red-700 dark:text-red-400",
      )}
    >
      <Icon className="size-2.5" strokeWidth={2.5} />
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
  const place =
    lastVisitor && (lastVisitor.city || lastVisitor.country)
      ? [
          lastVisitor.city,
          lastVisitor.country ? countryName(lastVisitor.country) : null,
        ]
          .filter(Boolean)
          .join(", ")
      : null;
  return (
    <div className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500/50 motion-safe:animate-ping" />
          <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
        </span>
        <span className="font-medium text-foreground/80">Live</span>
      </span>
      <Dim>·</Dim>
      <span>
        <span className="text-foreground tabular-nums font-medium">
          +{todayViews}
        </span>{" "}
        today
      </span>
      {lastVisitor ? (
        <>
          <Dim>·</Dim>
          <span>
            last view{" "}
            <span className="text-foreground/80">
              {relativeTime(lastVisitor.ts)}
            </span>
            {place ? (
              <>
                {" "}
                from{" "}
                <span className="text-foreground/80">
                  {countryFlag(lastVisitor.country)} {place}
                </span>
              </>
            ) : null}
          </span>
        </>
      ) : null}
    </div>
  );
}

// ─── Top referrers ────────────────────────────────────────────────

export function ReferrersList({ rows }: { rows: ReferrerRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyHint>
        Most visitors are coming directly. Share your link on LinkedIn or
        Twitter to see sources here.
      </EmptyHint>
    );
  }
  const max = Math.max(1, ...rows.map((r) => r.views));
  return (
    <ul className="flex flex-col">
      {rows.map((r) => (
        <li key={r.host}>
          <RankRow
            leading={
              <span className="flex size-5 items-center justify-center overflow-hidden rounded-md bg-muted/50 ring-1 ring-border/40">
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
            sublabel={r.host === prettyReferrer(r.host) ? undefined : r.host}
            value={r.views}
            barPct={Math.round((r.views / max) * 100)}
          />
        </li>
      ))}
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
  const max = Math.max(1, ...rows.map((r) => r.views));
  return (
    <ul className="flex flex-col">
      {rows.map((r) => (
        <li key={r.country}>
          <RankRow
            leading={
              <span className="flex size-5 items-center justify-center text-[15px] leading-none">
                {countryFlag(r.country)}
              </span>
            }
            label={countryName(r.country)}
            value={r.views}
            barPct={Math.round((r.views / max) * 100)}
          />
        </li>
      ))}
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
  const max = Math.max(1, ...filtered.map((r) => r.views));
  return (
    <ul className="flex flex-col">
      {filtered.map((r) => (
        <li key={r.device}>
          <RankRow
            leading={
              <span className="flex size-5 items-center justify-center rounded-md bg-muted/50 text-[10px] font-medium text-muted-foreground ring-1 ring-border/40">
                {(DEVICE_LABEL[r.device] ?? r.device)?.[0]}
              </span>
            }
            label={DEVICE_LABEL[r.device] ?? r.device}
            value={r.views}
            barPct={Math.round((r.views / max) * 100)}
          />
        </li>
      ))}
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
    <ul className="divide-y divide-border/30">
      {rows.map((r, i) => (
        <li key={i} className="py-2.5 first:pt-0 last:pb-0 flex items-start gap-3">
          <span className="mt-0.5 inline-flex size-7 items-center justify-center rounded-md bg-muted/40 text-[14px] leading-none">
            {countryFlag(r.country)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-medium leading-tight truncate">
              {[r.city, countryName(r.country)].filter(Boolean).join(", ") ||
                "Unknown location"}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11.5px] text-muted-foreground">
              <span>{relativeTime(r.ts)}</span>
              <Dim>·</Dim>
              <span>
                {r.referrer_host ? (
                  <>
                    via{" "}
                    <span className="text-foreground/80">
                      {prettyReferrer(r.referrer_host)}
                    </span>
                  </>
                ) : (
                  "direct"
                )}
              </span>
              {r.device && r.device !== "desktop" ? (
                <>
                  <Dim>·</Dim>
                  <span>{r.device}</span>
                </>
              ) : null}
              {r.browser && r.browser !== "Other" && r.browser !== "Unknown" ? (
                <>
                  <Dim>·</Dim>
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
              className={cn(
                "hidden sm:inline-flex shrink-0 self-center items-center rounded-md px-2 py-1",
                "text-[10.5px] font-mono text-muted-foreground/80",
                "transition-[background-color,color] duration-150 ease",
                "hover:bg-foreground/[0.04] hover:text-foreground",
              )}
            >
              {r.path.length > 32 ? r.path.slice(0, 32) + "…" : r.path}
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
  barPct,
}: {
  leading: React.ReactNode;
  label: string;
  sublabel?: string;
  value: number;
  barPct: number;
}) {
  return (
    <div className="group relative isolate">
      <span
        aria-hidden
        className="absolute inset-y-0.5 left-0 -z-10 rounded-md bg-foreground/[0.045] dark:bg-foreground/[0.07]"
        style={{ width: `${Math.max(2, barPct)}%` }}
      />
      <div className="relative flex items-center gap-2.5 px-2 py-2">
        <span className="shrink-0">{leading}</span>
        <div className="flex-1 min-w-0 flex items-baseline gap-2 overflow-hidden">
          <span className="truncate text-[12.5px] font-medium">{label}</span>
          {sublabel ? (
            <span className="hidden sm:inline truncate text-[11px] text-muted-foreground/70">
              {sublabel}
            </span>
          ) : null}
        </div>
        <span className="shrink-0 text-[12px] font-medium tabular-nums">
          {formatCount(value)}
        </span>
      </div>
    </div>
  );
}

function Dim({ children }: { children: React.ReactNode }) {
  return <span className="text-muted-foreground/40">{children}</span>;
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-border/50 bg-muted/15 px-3 py-3 text-[12px] text-muted-foreground">
      <Globe2 className="size-3.5 shrink-0 text-muted-foreground/60" strokeWidth={2} />
      <span>{children}</span>
    </div>
  );
}
