import type { D1Database } from "@cloudflare/workers-types";

/**
 * Analytics queries for the /app dashboard. All read from `view_events`
 * (migration 0014) and are scoped to a single profile slug.
 *
 * Conventions:
 *   - `days` is a rolling window from now (e.g. 30 = last 30 days).
 *   - Bots are filtered out of headline numbers via WHERE device != 'bot'.
 *   - Uniques are computed via COUNT(DISTINCT visitor_hash); the hash
 *     is per-visitor (not per-day), so the same person across multiple
 *     days counts once over the full window.
 *   - Time-series points are filled in JS so the chart renders smooth
 *     even if a day had zero hits — the SQL only returns days with data.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

// ─── Headline KPIs ────────────────────────────────────────────────

export interface OverviewKPIs {
  /** Total events in the window. Excludes bots. */
  views: number;
  /** Distinct visitor_hash in the window. Excludes bots. */
  uniques: number;
  /** Same metrics over the previous identical window. */
  prevViews: number;
  prevUniques: number;
  /** All-time event count for the slug. */
  viewsAllTime: number;
  /** Convenience deltas in percentage points. null = previous was zero. */
  viewsDeltaPct: number | null;
  uniquesDeltaPct: number | null;
  /** Distinct countries seen in the window. Excludes bots / unknown. */
  countriesReached: number;
}

export async function getOverviewKPIs(
  db: D1Database,
  slug: string,
  days: number,
): Promise<OverviewKPIs> {
  const now = Date.now();
  const windowStart = now - days * DAY_MS;
  const prevWindowStart = now - 2 * days * DAY_MS;

  const [windowRow, prevRow, allTimeRow] = await Promise.all([
    db
      .prepare(
        `SELECT
            COUNT(*) AS views,
            COUNT(DISTINCT visitor_hash) AS uniques,
            COUNT(DISTINCT CASE WHEN country IS NOT NULL THEN country END) AS countries
          FROM view_events
          WHERE slug = ? AND ts >= ? AND device != 'bot'`,
      )
      .bind(slug, windowStart)
      .first<{ views: number; uniques: number; countries: number }>(),
    db
      .prepare(
        `SELECT
            COUNT(*) AS views,
            COUNT(DISTINCT visitor_hash) AS uniques
          FROM view_events
          WHERE slug = ? AND ts >= ? AND ts < ? AND device != 'bot'`,
      )
      .bind(slug, prevWindowStart, windowStart)
      .first<{ views: number; uniques: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS views FROM view_events
          WHERE slug = ? AND device != 'bot'`,
      )
      .bind(slug)
      .first<{ views: number }>(),
  ]);

  const views = windowRow?.views ?? 0;
  const uniques = windowRow?.uniques ?? 0;
  const countries = windowRow?.countries ?? 0;
  const prevViews = prevRow?.views ?? 0;
  const prevUniques = prevRow?.uniques ?? 0;
  const viewsAllTime = allTimeRow?.views ?? 0;

  return {
    views,
    uniques,
    prevViews,
    prevUniques,
    viewsAllTime,
    countriesReached: countries,
    viewsDeltaPct: pctDelta(views, prevViews),
    uniquesDeltaPct: pctDelta(uniques, prevUniques),
  };
}

function pctDelta(curr: number, prev: number): number | null {
  if (prev === 0) return curr === 0 ? 0 : null;
  return Math.round(((curr - prev) / prev) * 100);
}

// ─── Timeseries (views + uniques per day) ─────────────────────────

export interface TimeseriesPoint {
  date: string; // YYYY-MM-DD (UTC)
  views: number;
  uniques: number;
}

export async function getViewsTimeseries(
  db: D1Database,
  slug: string,
  days: number,
): Promise<TimeseriesPoint[]> {
  const now = Date.now();
  const windowStart = now - days * DAY_MS;

  const rows = await db
    .prepare(
      `SELECT
          strftime('%Y-%m-%d', ts/1000, 'unixepoch') AS date,
          COUNT(*) AS views,
          COUNT(DISTINCT visitor_hash) AS uniques
        FROM view_events
        WHERE slug = ? AND ts >= ? AND device != 'bot'
        GROUP BY date
        ORDER BY date ASC`,
    )
    .bind(slug, windowStart)
    .all<{ date: string; views: number; uniques: number }>();

  const byDate = new Map(
    (rows.results ?? []).map((r) => [r.date, { views: r.views, uniques: r.uniques }]),
  );

  // Fill the full window so the chart x-axis is continuous even with
  // sparse data. We backfill from `days - 1` days ago through today.
  const filled: TimeseriesPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now - i * DAY_MS);
    const date = d.toISOString().slice(0, 10);
    const hit = byDate.get(date);
    filled.push({ date, views: hit?.views ?? 0, uniques: hit?.uniques ?? 0 });
  }
  return filled;
}

// ─── Top referrers ───────────────────────────────────────────────

export interface ReferrerRow {
  host: string;
  views: number;
  uniques: number;
}

export async function getTopReferrers(
  db: D1Database,
  slug: string,
  days: number,
  limit: number,
): Promise<ReferrerRow[]> {
  const windowStart = Date.now() - days * DAY_MS;
  // NULL / empty referrer_host bucket as 'direct' — typed-URL traffic,
  // bookmarks, and stripped-referer in-app browsers all show up there.
  const rows = await db
    .prepare(
      `SELECT
          COALESCE(NULLIF(referrer_host, ''), 'direct') AS host,
          COUNT(*) AS views,
          COUNT(DISTINCT visitor_hash) AS uniques
        FROM view_events
        WHERE slug = ? AND ts >= ? AND device != 'bot'
        GROUP BY host
        ORDER BY views DESC
        LIMIT ?`,
    )
    .bind(slug, windowStart, limit)
    .all<ReferrerRow>();
  return rows.results ?? [];
}

// ─── Top countries ───────────────────────────────────────────────

export interface CountryRow {
  country: string;
  views: number;
  uniques: number;
}

export async function getTopCountries(
  db: D1Database,
  slug: string,
  days: number,
  limit: number,
): Promise<CountryRow[]> {
  const windowStart = Date.now() - days * DAY_MS;
  const rows = await db
    .prepare(
      `SELECT
          country,
          COUNT(*) AS views,
          COUNT(DISTINCT visitor_hash) AS uniques
        FROM view_events
        WHERE slug = ? AND ts >= ? AND device != 'bot'
          AND country IS NOT NULL AND country != ''
        GROUP BY country
        ORDER BY views DESC
        LIMIT ?`,
    )
    .bind(slug, windowStart, limit)
    .all<CountryRow>();
  return rows.results ?? [];
}

// ─── Device / browser breakdown ──────────────────────────────────

export interface DeviceRow {
  device: string;
  views: number;
}

export async function getDeviceBreakdown(
  db: D1Database,
  slug: string,
  days: number,
): Promise<DeviceRow[]> {
  const windowStart = Date.now() - days * DAY_MS;
  const rows = await db
    .prepare(
      `SELECT device, COUNT(*) AS views
        FROM view_events
        WHERE slug = ? AND ts >= ? AND device != 'bot'
        GROUP BY device
        ORDER BY views DESC`,
    )
    .bind(slug, windowStart)
    .all<DeviceRow>();
  return rows.results ?? [];
}

export interface BrowserRow {
  browser: string;
  views: number;
}

export async function getBrowserBreakdown(
  db: D1Database,
  slug: string,
  days: number,
  limit: number,
): Promise<BrowserRow[]> {
  const windowStart = Date.now() - days * DAY_MS;
  const rows = await db
    .prepare(
      `SELECT browser, COUNT(*) AS views
        FROM view_events
        WHERE slug = ? AND ts >= ? AND device != 'bot'
          AND browser IS NOT NULL AND browser != '' AND browser != 'Unknown'
        GROUP BY browser
        ORDER BY views DESC
        LIMIT ?`,
    )
    .bind(slug, windowStart, limit)
    .all<BrowserRow>();
  return rows.results ?? [];
}

// ─── Hour-of-day pattern (24-bucket UTC histogram) ───────────────

export interface HourBucket {
  /** 0–23, UTC. The chart labels every 3rd hour to keep ticks readable. */
  hour: number;
  views: number;
}

export async function getHourlyPattern(
  db: D1Database,
  slug: string,
  days: number,
): Promise<HourBucket[]> {
  const windowStart = Date.now() - days * DAY_MS;
  const rows = await db
    .prepare(
      `SELECT
          CAST(strftime('%H', ts/1000, 'unixepoch') AS INTEGER) AS hour,
          COUNT(*) AS views
        FROM view_events
        WHERE slug = ? AND ts >= ? AND device != 'bot'
        GROUP BY hour
        ORDER BY hour ASC`,
    )
    .bind(slug, windowStart)
    .all<{ hour: number; views: number }>();

  // Fill all 24 buckets so the bar chart x-axis is continuous.
  const byHour = new Map(
    (rows.results ?? []).map((r) => [r.hour, r.views]),
  );
  return Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    views: byHour.get(h) ?? 0,
  }));
}

// ─── Recent visitor activity feed ────────────────────────────────

export interface RecentVisitorRow {
  ts: number;
  country: string | null;
  city: string | null;
  region: string | null;
  referrer_host: string | null;
  device: string | null;
  browser: string | null;
  os: string | null;
  path: string | null;
}

export async function getRecentVisitors(
  db: D1Database,
  slug: string,
  limit: number,
): Promise<RecentVisitorRow[]> {
  const rows = await db
    .prepare(
      `SELECT ts, country, city, region, referrer_host, device, browser, os, path
        FROM view_events
        WHERE slug = ? AND device != 'bot'
        ORDER BY ts DESC
        LIMIT ?`,
    )
    .bind(slug, limit)
    .all<RecentVisitorRow>();
  return rows.results ?? [];
}

// ─── Bundle: one round-trip for the dashboard page ──────────────

export interface DashboardData {
  kpis: OverviewKPIs;
  timeseries: TimeseriesPoint[];
  referrers: ReferrerRow[];
  countries: CountryRow[];
  devices: DeviceRow[];
  browsers: BrowserRow[];
  hourly: HourBucket[];
  recent: RecentVisitorRow[];
  hasAnyEvents: boolean;
}

export async function loadDashboard(
  db: D1Database,
  slug: string,
  days: number,
): Promise<DashboardData> {
  const [kpis, timeseries, referrers, countries, devices, browsers, hourly, recent] =
    await Promise.all([
      getOverviewKPIs(db, slug, days),
      getViewsTimeseries(db, slug, days),
      getTopReferrers(db, slug, days, 8),
      getTopCountries(db, slug, days, 8),
      getDeviceBreakdown(db, slug, days),
      getBrowserBreakdown(db, slug, days, 6),
      getHourlyPattern(db, slug, days),
      getRecentVisitors(db, slug, 12),
    ]);
  return {
    kpis,
    timeseries,
    referrers,
    countries,
    devices,
    browsers,
    hourly,
    recent,
    hasAnyEvents: kpis.viewsAllTime > 0,
  };
}
