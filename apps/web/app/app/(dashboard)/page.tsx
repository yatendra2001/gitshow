import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight, Eye, Globe2, Sparkles, UserRound } from "lucide-react";
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
  CountriesList,
  DevicesList,
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
 * Surface tree:
 *   - Not Pro                → NonProShowcase (full-bleed inside the shell)
 *   - Just checked out       → CheckoutProcessingState
 *   - Pro, no scan ever      → EmptyState (start your first scan)
 *   - Pro, scan running      → ScanningState (with link to live progress)
 *   - Pro, draft awaiting    → DraftState (review + publish)
 *   - Pro, last failed       → FailedState
 *   - Pro, published         → AnalyticsDashboard (this is the v1 win)
 *
 * For published users with an active scan running underneath, we show
 * the analytics dashboard with a thin banner pointing to the live
 * progress page.
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

  // Pre-published surfaces — same as before, just inside the shell.
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
    <div className="relative gs-ambient">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {/* Page header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-5 gs-enter">
          <div>
            <div className="text-[11.5px] uppercase tracking-wider text-muted-foreground/80 mb-1.5">
              Your portfolio
            </div>
            <h1 className="text-[26px] sm:text-[30px] font-semibold leading-tight tracking-tight">
              Analytics
            </h1>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {RANGE_LABEL[rangeKey]} · live at{" "}
              <Link
                href={`/${slug}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-foreground hover:underline underline-offset-2"
              >
                gitshow.io/{slug}
                <ArrowUpRight className="inline size-3 ml-0.5" />
              </Link>
            </p>
          </div>
          <RangeTabs current={rangeKey} />
        </div>

        {isScanning ? <ScanningBanner scanId={activeScan!.id} /> : null}
        {data.hasAnyEvents ? (
          <div className="mb-5">
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
            variant="accent"
            hint={`${RANGE_LABEL[rangeKey].toLowerCase()}`}
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
            action={
              data.hasAnyEvents ? (
                <ChartLegend />
              ) : (
                <span className="text-[11px] text-muted-foreground">
                  no data yet
                </span>
              )
            }
          >
            {data.hasAnyEvents ? (
              <ViewsAreaChart data={data.timeseries} />
            ) : (
              <ChartEmptyState slug={slug} />
            )}
          </SectionCard>
        </div>

        {/* Two-up: referrers + countries */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 mb-3">
          <SectionCard
            title="Top sources"
            subtitle="Where visitors came from"
            action={<TinyIconBadge icon={<Sparkles className="size-3" />} />}
          >
            <ReferrersList rows={data.referrers} />
          </SectionCard>
          <SectionCard
            title="Top countries"
            subtitle="Geographic reach"
            action={<TinyIconBadge icon={<Globe2 className="size-3" />} />}
          >
            <CountriesList rows={data.countries} />
          </SectionCard>
        </div>

        {/* Three-up: devices + recent (recent spans 2) */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <SectionCard title="Devices" subtitle="Browsers reading you">
            <DevicesList rows={data.devices} />
          </SectionCard>
          <SectionCard
            className="lg:col-span-2"
            title="Recent activity"
            subtitle="Latest visitors"
            action={
              <TinyIconBadge icon={<UserRound className="size-3" />} />
            }
          >
            <RecentActivity rows={data.recent} />
          </SectionCard>
        </div>

        <PublishedFooter daysSinceScan={lastScanDays} />
      </div>
    </div>
  );
}

// ─── Range tabs ───────────────────────────────────────────────────

function RangeTabs({ current }: { current: string }) {
  const ranges: Array<{ key: string; label: string }> = [
    { key: "7d", label: "7d" },
    { key: "30d", label: "30d" },
    { key: "90d", label: "90d" },
  ];
  return (
    <div className="inline-flex items-center rounded-xl border border-border/50 bg-card/40 p-0.5 self-start">
      {ranges.map((r) => {
        const active = r.key === current;
        return (
          <Link
            key={r.key}
            href={r.key === "30d" ? "/app" : `/app?range=${r.key}`}
            scroll={false}
            className={cn(
              "px-3 py-1.5 text-[12px] font-medium rounded-lg transition-colors",
              active
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground",
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
        <span className="size-2 rounded-sm bg-[var(--gradient-secondary)]" />
        Uniques
      </span>
    </div>
  );
}

function TinyIconBadge({ icon }: { icon: React.ReactNode }) {
  return (
    <span className="inline-flex size-6 items-center justify-center rounded-md border border-border/40 bg-card text-muted-foreground">
      {icon}
    </span>
  );
}

function ChartEmptyState({ slug }: { slug: string }) {
  return (
    <div className="flex h-[260px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/40 bg-muted/10 text-center">
      <Eye className="size-5 text-muted-foreground/70" strokeWidth={2} />
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
        className="inline-flex items-center gap-1 rounded-lg border border-border/60 bg-card/60 px-3 py-1.5 text-[12px] font-medium hover:bg-card transition-colors"
      >
        Open your portfolio
        <ArrowUpRight className="size-3.5" />
      </Link>
    </div>
  );
}

function ScanningBanner({ scanId }: { scanId: string }) {
  return (
    <Link
      href={`/app/scan/${scanId}`}
      className="mb-5 flex items-center gap-2.5 rounded-xl border border-border/40 bg-card/40 px-3.5 py-2 text-[12.5px] hover:bg-card/60 transition-colors gs-enter"
    >
      <span className="relative flex size-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-50" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
      </span>
      <span className="font-medium">Refresh in progress</span>
      <span className="text-muted-foreground">
        Your dashboard updates the moment it lands.
      </span>
      <ArrowUpRight className="ml-auto size-3.5 text-muted-foreground" />
    </Link>
  );
}
