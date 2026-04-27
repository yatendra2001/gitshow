import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight01Icon, ViewIcon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/dashboard/icon";
import { getCloudflareContext } from "@opennextjs/cloudflare";
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
import { loadDashboard } from "@/lib/analytics";
import {
  BrowsersDonut,
  CountriesList,
  DevicesDonut,
  HourlyTraffic,
  KpiCard,
  LiveTicker,
  RecentActivity,
  ReferrersList,
  SectionCard,
} from "@/components/dashboard/analytics-cards";
import { ViewsAreaChart } from "@/components/dashboard/analytics-charts";
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

  if (!ctx.isPro) {
    return (
      <NonProShowcase
        handle={ctx.handle}
        hasPublished={ctx.isPublished}
        wasCancelled={ctx.subscriptionStatus === "cancelled"}
      />
    );
  }
  if (justCheckedOut) return <CheckoutProcessingState />;

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

  // ─── Published — load analytics ──────────────────────────────

  const slug = ctx.profile?.public_slug ?? ctx.handle.toLowerCase();
  const data = await loadDashboard(env.DB, slug, days);

  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);
  const todayViews = data.timeseries.reduce((acc, p) => {
    const pd = new Date(p.date + "T00:00:00Z").getTime();
    return pd >= todayMidnight.getTime() ? acc + p.views : acc;
  }, 0);

  const sparkViews = data.timeseries.map((p, i) => ({ x: i, value: p.views }));
  const sparkUniques = data.timeseries.map((p, i) => ({
    x: i,
    value: p.uniques,
  }));

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
            {RANGE_LABEL[rangeKey]} · live at{" "}
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

      {data.hasAnyEvents ? (
        <div className="mb-6">
          <LiveTicker
            todayViews={todayViews}
            lastVisitor={data.recent[0] ?? null}
          />
        </div>
      ) : null}

      {/* Hero KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-3">
        <KpiCard
          label="Views"
          value={data.kpis.views}
          deltaPct={data.kpis.viewsDeltaPct}
          sparkline={sparkViews}
          hint={RANGE_LABEL[rangeKey].toLowerCase()}
        />
        <KpiCard
          label="Unique visitors"
          value={data.kpis.uniques}
          deltaPct={data.kpis.uniquesDeltaPct}
          sparkline={sparkUniques}
          hint="distinct people"
        />
        <KpiCard
          label="Countries"
          value={data.kpis.countriesReached}
          hint="reached this period"
        />
        <KpiCard
          label="All-time views"
          value={data.kpis.viewsAllTime}
          hint="since launch"
        />
      </div>

      {/* Big chart */}
      <div className="mb-3">
        <SectionCard
          title="Views over time"
          subtitle={`Daily totals · ${RANGE_LABEL[rangeKey].toLowerCase()}`}
          action={data.hasAnyEvents ? <ChartLegend /> : null}
        >
          {data.hasAnyEvents ? (
            <ViewsAreaChart data={data.timeseries} />
          ) : (
            <ChartEmptyState slug={slug} />
          )}
        </SectionCard>
      </div>

      {/* Hour-of-day pattern */}
      <div className="mb-3">
        <SectionCard
          title="Visit timing"
          subtitle="When readers show up, by hour of day"
        >
          <HourlyTraffic rows={data.hourly} />
        </SectionCard>
      </div>

      {/* Two-up: referrers + countries */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 mb-3">
        <SectionCard title="Top sources" subtitle="Where visitors came from">
          <ReferrersList rows={data.referrers} />
        </SectionCard>
        <SectionCard title="Top countries" subtitle="Geographic reach">
          <CountriesList rows={data.countries} />
        </SectionCard>
      </div>

      {/* Two-up: devices donut + browsers donut */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 mb-3">
        <SectionCard title="Devices" subtitle="What people read you on">
          <DevicesDonut rows={data.devices} />
        </SectionCard>
        <SectionCard title="Browsers" subtitle="Engines doing the rendering">
          <BrowsersDonut rows={data.browsers} />
        </SectionCard>
      </div>

      {/* Recent activity, full width */}
      <div className="grid grid-cols-1 gap-3">
        <SectionCard title="Recent activity" subtitle="Latest visitors">
          <RecentActivity rows={data.recent} />
        </SectionCard>
      </div>

      <PublishedFooter daysSinceScan={lastScanDays} />
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
