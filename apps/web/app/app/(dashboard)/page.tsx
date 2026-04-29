import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight01Icon, ViewIcon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/dashboard/icon";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { D1Database } from "@cloudflare/workers-types";
import {
  CheckoutProcessingState,
  DraftState,
  EmptyState,
  FailedState,
  NonProShowcase,
  PublishedFooter,
  ScanningState,
  type ScanSlim,
  safeParse,
} from "./_home-states";
import { loadDashboardContext } from "./_context";
import { loadDraftResume } from "@/lib/resume-io";
import {
  getAttributionSplit,
  getBrowserBreakdown,
  getDeviceBreakdown,
  getHourlyPattern,
  getOverviewKPIs,
  getRecentVisitors,
  getTopCountries,
  getTopReferrers,
  getViewsTimeseries,
} from "@/lib/analytics";
import { getDomainByUser } from "@/lib/domains/repo";
import {
  BrowsersDonut,
  DevicesDonut,
  KpiCard,
  LiveTicker,
  RecentActivity,
  SectionCard,
} from "@/components/dashboard/analytics-cards";
import { DomainAttributionCard } from "@/components/dashboard/domain-attribution";
import {
  HourlyTraffic,
  SourcesBarChart,
  ViewsAreaChart,
} from "@/components/dashboard/analytics-charts-lazy";
import { CountriesMap } from "@/components/dashboard/analytics-map-lazy";
import {
  KpiCardSkeleton,
  Skeleton,
} from "@/components/dashboard/skeleton";
import type {
  AccessState,
  DataSources,
} from "@/components/scan/access-state-card";
import { cn } from "@/lib/utils";

/**
 * /app — sidebar dashboard home.
 *
 * Surface tree (Pro users):
 *   - Just checked out      → CheckoutProcessingState
 *   - No scan ever          → EmptyState (start your first scan)
 *   - Scan running          → ScanningState (link to live progress)
 *   - Draft awaiting        → DraftState (review + publish)
 *   - Last failed           → FailedState
 *   - Published             → AnalyticsDashboard
 *
 * Non-Pro users see NonProShowcase inside the same shell.
 */

export const dynamic = "force-dynamic";

const RANGE_DAYS: Record<string, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

const RANGE_LABEL: Record<string, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
};

export default async function AppHomePage({
  searchParams,
}: {
  searchParams?: Promise<{
    checkout?: string | string[];
    range?: string | string[];
  }>;
}) {
  const ctx = await loadDashboardContext();
  if (!ctx) redirect("/signin");

  const sp = (await searchParams) ?? {};
  const checkoutParam = Array.isArray(sp.checkout) ? sp.checkout[0] : sp.checkout;
  const rangeParam = Array.isArray(sp.range) ? sp.range[0] : sp.range;
  const justCheckedOut = checkoutParam === "success";
  const rangeKey =
    rangeParam && rangeParam in RANGE_DAYS ? rangeParam : "30d";
  const days = RANGE_DAYS[rangeKey];

  // Order matters: a user who just hit Dodo's success URL is in the
  // window between checkout completing and `subscription.active`
  // landing via webhook. During that gap `ctx.isPro` is still false,
  // so the NonProShowcase check below would intercept and hide the
  // polling screen. CheckoutProcessingState handles its own bail-out
  // (90s hard-stop with a retry CTA) so a missing webhook can't leave
  // the customer here forever.
  if (!ctx.isPro && justCheckedOut) return <CheckoutProcessingState />;
  if (!ctx.isPro) {
    return (
      <NonProShowcase
        handle={ctx.handle}
        hasPublished={ctx.isPublished}
        wasCancelled={ctx.subscriptionStatus === "cancelled"}
      />
    );
  }

  const { env } = await getCloudflareContext({ async: true });
  const userId = ctx.userId;

  const [latestScan, activeScan, draftResume] = await Promise.all([
    env.DB.prepare(
      `SELECT id, status, handle, current_phase, error, created_at, completed_at,
              access_state, data_sources
         FROM scans WHERE user_id = ?
         ORDER BY created_at DESC LIMIT 1`,
    )
      .bind(userId)
      .first<ScanSlim>(),
    env.DB.prepare(
      `SELECT id, status, handle, current_phase, error, created_at, completed_at,
              access_state, data_sources
         FROM scans
         WHERE user_id = ? AND status IN ('queued','running')
         ORDER BY created_at DESC LIMIT 1`,
    )
      .bind(userId)
      .first<ScanSlim>(),
    ctx.handle ? loadDraftResume(env.BUCKET, ctx.handle) : null,
  ]);

  const hasDraft = Boolean(draftResume);
  const isScanning = Boolean(activeScan);
  const draftReady = hasDraft && !ctx.isPublished && !isScanning;
  const lastFailed =
    latestScan?.status === "failed" &&
    !activeScan &&
    !ctx.isPublished &&
    !draftReady;

  if (isScanning && !ctx.isPublished) return <ScanningState scan={activeScan!} />;
  if (draftReady) {
    const accessSnapshot = latestScan
      ? {
          accessState: safeParse<AccessState>(latestScan.access_state),
          dataSources: safeParse<DataSources>(latestScan.data_sources),
        }
      : null;
    return <DraftState handle={ctx.handle} access={accessSnapshot} />;
  }
  if (lastFailed) return <FailedState scan={latestScan!} />;
  if (!ctx.isPublished) return <EmptyState handle={ctx.handle} />;

  // ─── Published — stream analytics sections ──────────────────────
  //
  // Every section below is its own async server component wrapped in
  // <Suspense>. The page shell (header + range tabs + scanning banner
  // + footer) renders immediately; each card streams in as its D1
  // query resolves. With React.cache on the get* helpers, sections
  // that share a query (LiveTicker + KPIs + Timeseries all want
  // `getViewsTimeseries`) trigger one DB round-trip total.
  //
  // Result: instead of waiting for the slowest of 8 parallel queries
  // before any chart renders, the first card lands as soon as its
  // own query is back. Slowest still wins for the last card, but the
  // perceived load time is the fastest, not the slowest.

  const slug = ctx.profile?.public_slug ?? ctx.handle.toLowerCase();
  const db = env.DB;
  const rangeLabel = RANGE_LABEL[rangeKey];

  const lastScanDays = ctx.profile?.last_scan_at
    ? Math.floor((Date.now() - ctx.profile.last_scan_at) / (1000 * 60 * 60 * 24))
    : null;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-6">
        <div>
          <div className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70 mb-2">
            Your portfolio
          </div>
          <h1 className="text-[28px] sm:text-[32px] font-semibold leading-none tracking-tight">
            Analytics
          </h1>
          <p className="mt-2 text-[12.5px] text-muted-foreground">
            {rangeLabel} · live at{" "}
            <Link
              href={`/${slug}`}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-foreground hover:underline underline-offset-2"
            >
              gitshow.io/{slug}
              <Icon
                icon={ArrowUpRight01Icon}
                className="inline size-3 ml-0.5"
              />
            </Link>
          </p>
        </div>
        <RangeTabs current={rangeKey} />
      </div>

      {isScanning ? <ScanningBanner scanId={activeScan!.id} /> : null}

      <Suspense fallback={null}>
        <LiveTickerStream db={db} slug={slug} days={days} />
      </Suspense>

      {/* Custom domain attribution — only renders if the user has an
          active custom domain. Streams independently so it doesn't
          delay anything else. */}
      <Suspense fallback={null}>
        <AttributionStream db={db} slug={slug} userId={ctx.userId} days={days} />
      </Suspense>

      {/* Hero KPIs */}
      <Suspense fallback={<KpiGridSkeleton />}>
        <KpiStream db={db} slug={slug} days={days} rangeLabel={rangeLabel} />
      </Suspense>

      {/* Big chart */}
      <div className="mb-3">
        <Suspense
          fallback={
            <SectionCard
              title="Views over time"
              subtitle={`Daily totals · ${rangeLabel.toLowerCase()}`}
            >
              <Skeleton className="h-[280px] w-full rounded-xl" />
            </SectionCard>
          }
        >
          <TimeseriesStream
            db={db}
            slug={slug}
            days={days}
            rangeLabel={rangeLabel}
          />
        </Suspense>
      </div>

      {/* Hour-of-day pattern */}
      <div className="mb-3">
        <SectionCard
          title="Visit timing"
          subtitle="When readers show up, by hour of day"
        >
          <Suspense fallback={<Skeleton className="h-[140px] w-full rounded-xl" />}>
            <HourlyStream db={db} slug={slug} days={days} />
          </Suspense>
        </SectionCard>
      </div>

      {/* World map, full width */}
      <div className="mb-3">
        <SectionCard title="Top countries" subtitle="Geographic reach">
          <Suspense
            fallback={<Skeleton className="aspect-[2/1] w-full rounded-xl" />}
          >
            <CountriesStream db={db} slug={slug} days={days} />
          </Suspense>
        </SectionCard>
      </div>

      {/* Top sources, full width — horizontal bar chart with favicons */}
      <div className="mb-3">
        <SectionCard title="Top sources" subtitle="Where visitors came from">
          <Suspense fallback={<Skeleton className="h-[220px] w-full rounded-xl" />}>
            <SourcesStream db={db} slug={slug} days={days} />
          </Suspense>
        </SectionCard>
      </div>

      {/* Two-up: devices pie + browsers donut (mixed variants) */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 mb-3">
        <SectionCard title="Devices" subtitle="What people read you on">
          <Suspense fallback={<Skeleton className="h-[200px] w-full rounded-xl" />}>
            <DevicesStream db={db} slug={slug} days={days} />
          </Suspense>
        </SectionCard>
        <SectionCard title="Browsers" subtitle="Engines doing the rendering">
          <Suspense fallback={<Skeleton className="h-[200px] w-full rounded-xl" />}>
            <BrowsersStream db={db} slug={slug} days={days} />
          </Suspense>
        </SectionCard>
      </div>

      {/* Recent activity, full width */}
      <div className="grid grid-cols-1 gap-3">
        <SectionCard title="Recent activity" subtitle="Latest visitors">
          <Suspense fallback={<Skeleton className="h-[240px] w-full rounded-xl" />}>
            <RecentStream db={db} slug={slug} />
          </Suspense>
        </SectionCard>
      </div>

      <PublishedFooter daysSinceScan={lastScanDays} />
    </div>
  );
}

// ─── Streaming sections ───────────────────────────────────────────
//
// Each component is an independent Suspense boundary. They share the
// React.cache-wrapped helpers in lib/analytics.ts so a query that two
// sections need (timeseries, recent) only hits D1 once per request.

interface SectionProps {
  db: D1Database;
  slug: string;
  days: number;
}

async function LiveTickerStream({ db, slug, days }: SectionProps) {
  const [kpis, timeseries, recent] = await Promise.all([
    getOverviewKPIs(db, slug, days),
    getViewsTimeseries(db, slug, days),
    getRecentVisitors(db, slug, 12),
  ]);
  if (kpis.viewsAllTime === 0) return null;
  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);
  const todayViews = timeseries.reduce((acc, p) => {
    const pd = new Date(p.date + "T00:00:00Z").getTime();
    return pd >= todayMidnight.getTime() ? acc + p.views : acc;
  }, 0);
  return (
    <div className="mb-6 gs-enter">
      <LiveTicker todayViews={todayViews} lastVisitor={recent[0] ?? null} />
    </div>
  );
}

async function KpiStream({
  db,
  slug,
  days,
  rangeLabel,
}: SectionProps & { rangeLabel: string }) {
  const [kpis, timeseries] = await Promise.all([
    getOverviewKPIs(db, slug, days),
    getViewsTimeseries(db, slug, days),
  ]);
  const sparkViews = timeseries.map((p, i) => ({ x: i, value: p.views }));
  const sparkUniques = timeseries.map((p, i) => ({ x: i, value: p.uniques }));
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-3 gs-enter">
      <KpiCard
        label="Views"
        value={kpis.views}
        deltaPct={kpis.viewsDeltaPct}
        sparkline={sparkViews}
        hint={rangeLabel.toLowerCase()}
      />
      <KpiCard
        label="Unique visitors"
        value={kpis.uniques}
        deltaPct={kpis.uniquesDeltaPct}
        sparkline={sparkUniques}
        hint="distinct people"
      />
      <KpiCard
        label="Countries"
        value={kpis.countriesReached}
        hint="reached this period"
      />
      <KpiCard
        label="All-time views"
        value={kpis.viewsAllTime}
        hint="since launch"
      />
    </div>
  );
}

function KpiGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-3">
      <KpiCardSkeleton />
      <KpiCardSkeleton />
      <KpiCardSkeleton />
      <KpiCardSkeleton />
    </div>
  );
}

async function TimeseriesStream({
  db,
  slug,
  days,
  rangeLabel,
}: SectionProps & { rangeLabel: string }) {
  const [kpis, timeseries] = await Promise.all([
    getOverviewKPIs(db, slug, days),
    getViewsTimeseries(db, slug, days),
  ]);
  const hasEvents = kpis.viewsAllTime > 0;
  return (
    <SectionCard
      title="Views over time"
      subtitle={`Daily totals · ${rangeLabel.toLowerCase()}`}
      action={hasEvents ? <ChartLegend /> : null}
      className="gs-enter"
    >
      {hasEvents ? (
        <ViewsAreaChart data={timeseries} />
      ) : (
        <ChartEmptyState slug={slug} />
      )}
    </SectionCard>
  );
}

async function HourlyStream({ db, slug, days }: SectionProps) {
  const hourly = await getHourlyPattern(db, slug, days);
  return (
    <div className="gs-enter">
      <HourlyTraffic rows={hourly} />
    </div>
  );
}

async function CountriesStream({ db, slug, days }: SectionProps) {
  const countries = await getTopCountries(db, slug, days, 8);
  return (
    <div className="gs-enter">
      <CountriesMap rows={countries} />
    </div>
  );
}

async function SourcesStream({ db, slug, days }: SectionProps) {
  const referrers = await getTopReferrers(db, slug, days, 8);
  return (
    <div className="gs-enter">
      <SourcesBarChart rows={referrers} />
    </div>
  );
}

async function DevicesStream({ db, slug, days }: SectionProps) {
  const devices = await getDeviceBreakdown(db, slug, days);
  return (
    <div className="gs-enter">
      <DevicesDonut rows={devices} />
    </div>
  );
}

async function BrowsersStream({ db, slug, days }: SectionProps) {
  const browsers = await getBrowserBreakdown(db, slug, days, 6);
  return (
    <div className="gs-enter">
      <BrowsersDonut rows={browsers} />
    </div>
  );
}

async function RecentStream({ db, slug }: Omit<SectionProps, "days">) {
  const recent = await getRecentVisitors(db, slug, 12);
  return (
    <div className="gs-enter">
      <RecentActivity rows={recent} />
    </div>
  );
}

async function AttributionStream({
  db,
  slug,
  userId,
  days,
}: SectionProps & { userId: string }) {
  const [domain, split] = await Promise.all([
    getDomainByUser(db, userId),
    getAttributionSplit(db, slug, days),
  ]);
  if (!domain || domain.status !== "active") return null;
  if (!split.total) return null;
  return (
    <div className="mb-3 gs-enter">
      <DomainAttributionCard split={split} customHostname={domain.hostname} />
    </div>
  );
}

// ─── Range tabs ───────────────────────────────────────────────────

function RangeTabs({ current }: { current: string }) {
  const ranges: Array<{ key: string; label: string }> = [
    { key: "7d", label: "7 days" },
    { key: "30d", label: "30 days" },
    { key: "90d", label: "90 days" },
  ];
  return (
    <div className="inline-flex items-center rounded-lg border border-border/50 bg-card/60 p-0.5 self-start">
      {ranges.map((r) => {
        const active = r.key === current;
        return (
          <Link
            key={r.key}
            href={r.key === "30d" ? "/app" : `/app?range=${r.key}`}
            scroll={false}
            className={cn(
              "relative px-3 py-1 text-[12px] font-medium rounded-md",
              "transition-[color,transform] duration-[140ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
              "active:scale-[0.97] active:duration-[80ms]",
              "outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset",
              active
                ? "bg-background text-foreground shadow-[0_0_0_1px_oklch(from_var(--foreground)_l_c_h/0.08),0_1px_2px_-1px_oklch(0_0_0_/_0.06)]"
                : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]",
            )}
          >
            {r.label}
          </Link>
        );
      })}
    </div>
  );
}

function ChartLegend() {
  return (
    <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2 rounded-sm bg-[var(--gradient-primary)]" />
        Views
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden
          className="inline-block h-[2px] w-3 bg-[var(--gradient-primary)] opacity-55"
          style={{
            backgroundImage:
              "repeating-linear-gradient(to right, currentColor 0 3px, transparent 3px 6px)",
          }}
        />
        Uniques
      </span>
    </div>
  );
}

function ChartEmptyState({ slug }: { slug: string }) {
  return (
    <div className="flex h-[280px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/50 bg-muted/10 text-center">
      <Icon icon={ViewIcon} className="size-5 text-muted-foreground/70" />
      <div>
        <p className="text-[13px] font-medium">No views yet</p>
        <p className="mt-0.5 text-[11.5px] text-muted-foreground">
          Share your link to start collecting data.
        </p>
      </div>
      <Link
        href={`/${slug}`}
        target="_blank"
        rel="noreferrer"
        className={cn(
          "group inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[12px] font-medium",
          "border border-border/60 bg-card/60 text-foreground select-none",
          "transition-[background-color,border-color,transform] duration-[140ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
          "hover:bg-card hover:border-foreground/25",
          "active:scale-[0.97] active:duration-[80ms]",
          "outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        )}
      >
        Open your portfolio
        <Icon
          icon={ArrowUpRight01Icon}
          className="size-3.5 transition-transform duration-[180ms] ease-[cubic-bezier(0.215,0.61,0.355,1)] group-hover:-translate-y-px group-hover:translate-x-px"
        />
      </Link>
    </div>
  );
}

function ScanningBanner({ scanId }: { scanId: string }) {
  return (
    <Link
      href={`/app/scan/${scanId}`}
      className={cn(
        "mb-6 flex items-center gap-2.5 rounded-lg border border-border/50 bg-card/60 px-3.5 py-2 text-[12.5px]",
        "transition-[background-color] duration-150 ease",
        "hover:bg-card",
      )}
    >
      <span className="relative flex size-1.5">
        <span className="absolute inline-flex h-full w-full motion-safe:animate-ping rounded-full bg-amber-500/50" />
        <span className="relative inline-flex size-1.5 rounded-full bg-amber-500" />
      </span>
      <span className="font-medium">Refresh in progress</span>
      <span className="text-muted-foreground">
        Your dashboard updates the moment it lands.
      </span>
      <Icon
        icon={ArrowUpRight01Icon}
        className="ml-auto size-3.5 text-muted-foreground"
      />
    </Link>
  );
}
