#!/usr/bin/env bun
/**
 * One-off importer for Cloudflare GraphQL Analytics → gitshow `view_events`.
 *
 * Stand-alone script. NOT a product feature. Useful when a customer's
 * domain was already on Cloudflare for a while before they connected to
 * gitshow and they want to see lifetime numbers in the dashboard.
 *
 * What it does:
 *   1. Queries Cloudflare's GraphQL Analytics API for the
 *      `httpRequestsAdaptiveGroups` dataset, filtered to a specific
 *      hostname on a specific zone, over a date range.
 *   2. Translates each (hour, country) bucket of `visits` into N
 *      synthetic rows for the `view_events` table — one row per visit,
 *      with deterministic-but-fake `visitor_hash`.
 *   3. Emits a SQL file you review, then apply via:
 *        bunx wrangler d1 execute gitshow-db --remote \
 *          --file=apps/web/scripts/.cf-import.sql
 *
 * Free CF tier limitations baked into the output:
 *   - ~30 days of history max.
 *   - No real referrer / browser / OS / device — synthetic rows have
 *     device='desktop', browser/os='Other', referrer NULL.
 *   - All visits get path='/'.
 *   - Country only (no region/city).
 *
 * Mental model: hostname-level aggregate traffic projected onto our
 * per-visit schema. Daily totals + country breakdown will be accurate;
 * everything else is best-effort.
 *
 * Usage:
 *   CF_API_TOKEN=... CF_ZONE_ID=... bun apps/web/scripts/import-cf-analytics.ts \
 *     --hostname=www.yatendrakumar.com \
 *     --slug=yatendra2001 \
 *     --days=30 \
 *     [--dry-run]
 *
 * Token scope: `Account.Account Analytics:Read` and `Zone.Analytics:Read`
 * on the zone.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

// ─── Args ──────────────────────────────────────────────────────────────

interface Args {
  hostname: string;
  slug: string;
  days: number;
  dryRun: boolean;
  token: string;
  zoneId: string;
  outFile: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (name: string): string | undefined => {
    const eq = argv.find((a) => a.startsWith(`--${name}=`));
    if (eq) return eq.slice(name.length + 3);
    const idx = argv.indexOf(`--${name}`);
    if (idx >= 0 && argv[idx + 1] && !argv[idx + 1]!.startsWith("--")) {
      return argv[idx + 1];
    }
    return undefined;
  };
  const has = (name: string) => argv.includes(`--${name}`);

  const hostname = get("hostname");
  const slug = get("slug");
  const days = Number.parseInt(get("days") ?? "30", 10);
  const token =
    get("token") ??
    process.env.CF_API_TOKEN ??
    process.env.CLOUDFLARE_API_TOKEN ??
    "";
  const zoneId =
    get("zone") ??
    process.env.CF_ZONE_ID ??
    process.env.CF_FOR_SAAS_ZONE_ID ??
    "";
  const outFile = get("out") ?? "apps/web/scripts/.cf-import.sql";

  if (!hostname || !slug || !token || !zoneId) {
    console.error(
      `Usage:\n  CF_API_TOKEN=... CF_ZONE_ID=... bun ${process.argv[1]} \\\n    --hostname=www.example.com \\\n    --slug=public_slug \\\n    [--days=30] [--out=file.sql] [--dry-run]\n`,
    );
    process.exit(1);
  }
  if (!Number.isFinite(days) || days < 1 || days > 30) {
    console.error("--days must be 1–30 (Free plan retention is ~30 days).");
    process.exit(1);
  }

  return {
    hostname,
    slug,
    days,
    dryRun: has("dry-run"),
    token,
    zoneId,
    outFile,
  };
}

// ─── Cloudflare GraphQL ────────────────────────────────────────────────

interface CfBucket {
  count: number;
  sum: { visits: number };
  dimensions: {
    datetimeHour: string;
    clientCountryName: string;
  };
}

interface CfResponse {
  data?: {
    viewer?: {
      zones?: Array<{
        httpRequestsAdaptiveGroups?: CfBucket[];
      }>;
    };
  };
  errors?: Array<{ message: string }>;
}

const QUERY = `
query ImportZoneAnalytics(
  $zoneTag: string!,
  $since: Time!,
  $until: Time!,
  $hostname: string!
) {
  viewer {
    zones(filter: { zoneTag: $zoneTag }) {
      httpRequestsAdaptiveGroups(
        limit: 10000,
        filter: {
          datetime_geq: $since,
          datetime_lt: $until,
          clientRequestHTTPHost: $hostname,
          requestSource: "eyeball"
        },
        orderBy: [datetimeHour_ASC]
      ) {
        count
        sum {
          visits
        }
        dimensions {
          datetimeHour
          clientCountryName
        }
      }
    }
  }
}`;

async function fetchOneDay(
  args: Args,
  since: Date,
  until: Date,
): Promise<CfBucket[]> {
  const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: {
      authorization: `Bearer ${args.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query: QUERY,
      variables: {
        zoneTag: args.zoneId,
        since: since.toISOString(),
        until: until.toISOString(),
        hostname: args.hostname,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Cloudflare API ${res.status}: ${body.slice(0, 500)}`);
  }
  const json = (await res.json()) as CfResponse;
  if (json.errors?.length) {
    throw new Error(
      `GraphQL errors:\n${json.errors.map((e) => `  - ${e.message}`).join("\n")}`,
    );
  }
  return json.data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups ?? [];
}

/**
 * Free CF for SaaS plans cap each httpRequestsAdaptiveGroups query to a
 * 1-day time window (the API rejects wider ranges with a clear error).
 * To cover N days, we issue N separate 1-day queries and concatenate
 * the buckets. Older days that exceed the plan's data retention will
 * simply return empty arrays — we keep going so the caller can see
 * exactly how far back the data really goes.
 *
 * Lightly throttled (200ms between requests) to stay friendly with
 * Cloudflare's rate limits even when --days=30.
 */
async function fetchCfBuckets(args: Args): Promise<CfBucket[]> {
  const until = new Date();
  until.setUTCMinutes(0, 0, 0);

  const all: CfBucket[] = [];
  const dayMs = 24 * 60 * 60 * 1000;
  for (let dayBack = 1; dayBack <= args.days; dayBack++) {
    const dayUntil = new Date(until.getTime() - (dayBack - 1) * dayMs);
    const daySince = new Date(dayUntil.getTime() - dayMs);
    try {
      const buckets = await fetchOneDay(args, daySince, dayUntil);
      if (buckets.length > 0) {
        process.stderr.write(
          `  ${daySince.toISOString().slice(0, 10)}: ${buckets.length} buckets\n`,
        );
        all.push(...buckets);
      } else {
        process.stderr.write(
          `  ${daySince.toISOString().slice(0, 10)}: empty\n`,
        );
      }
    } catch (err) {
      // Older days may exceed retention; surface the error but keep
      // going so we still get whatever IS available.
      process.stderr.write(
        `  ${daySince.toISOString().slice(0, 10)}: ${(err as Error).message.slice(0, 100)}\n`,
      );
    }
    // Friendly pacing.
    await new Promise((r) => setTimeout(r, 200));
  }
  return all;
}

// ─── Bucket → view_events rows ─────────────────────────────────────────

interface ViewEventRow {
  slug: string;
  visitor_hash: string;
  referrer_host: string | null;
  referrer_url: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  device: string;
  browser: string;
  os: string;
  path: string;
  ts: number;
  served_hostname: string;
  is_custom_domain: number;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
}

const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  "United States": "US",
  India: "IN",
  "United Kingdom": "GB",
  Germany: "DE",
  Canada: "CA",
  Australia: "AU",
  France: "FR",
  Brazil: "BR",
  Japan: "JP",
  China: "CN",
  Singapore: "SG",
  Netherlands: "NL",
  Spain: "ES",
  Italy: "IT",
  Mexico: "MX",
  "South Korea": "KR",
  Poland: "PL",
  Russia: "RU",
  Sweden: "SE",
  Norway: "NO",
  Finland: "FI",
  Denmark: "DK",
  Ireland: "IE",
  Switzerland: "CH",
  Austria: "AT",
  Belgium: "BE",
  Portugal: "PT",
  "New Zealand": "NZ",
  Indonesia: "ID",
  Philippines: "PH",
  Thailand: "TH",
  Malaysia: "MY",
  Vietnam: "VN",
  "Hong Kong": "HK",
  Taiwan: "TW",
  "South Africa": "ZA",
  Israel: "IL",
  Turkey: "TR",
  "United Arab Emirates": "AE",
  "Saudi Arabia": "SA",
  Argentina: "AR",
  Chile: "CL",
  Colombia: "CO",
  "Czech Republic": "CZ",
  Hungary: "HU",
  Romania: "RO",
  Greece: "GR",
  Ukraine: "UA",
  Egypt: "EG",
  Pakistan: "PK",
  Bangladesh: "BD",
  Nigeria: "NG",
  Kenya: "KE",
};

function countryCode(name: string): string | null {
  if (!name || name === "Unknown") return null;
  if (COUNTRY_NAME_TO_CODE[name]) return COUNTRY_NAME_TO_CODE[name]!;
  const initials = name
    .split(/\s+/)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2);
  return initials || null;
}

function syntheticVisitorHash(
  hostname: string,
  hourIso: string,
  country: string,
  visitIndex: number,
): string {
  const h = createHash("sha256");
  h.update(`cf-import:${hostname}:${hourIso}:${country}:${visitIndex}`);
  return h.digest("hex").slice(0, 24);
}

function spreadWithinHour(hourIso: string, n: number): number[] {
  const hourStart = new Date(hourIso).getTime();
  const hourMs = 60 * 60 * 1000;
  if (n <= 0) return [];
  if (n === 1) return [hourStart + hourMs / 2];
  const step = hourMs / n;
  return Array.from({ length: n }, (_, i) =>
    Math.floor(hourStart + step * i + step / 2),
  );
}

function bucketsToRows(buckets: CfBucket[], args: Args): ViewEventRow[] {
  const rows: ViewEventRow[] = [];
  const isCustom =
    !/(^|\.)gitshow\.io$/.test(args.hostname) &&
    !args.hostname.endsWith(".workers.dev");

  for (const bucket of buckets) {
    const hourIso = bucket.dimensions.datetimeHour;
    const visits = bucket.sum.visits || bucket.count || 0;
    if (visits <= 0) continue;
    const country = countryCode(bucket.dimensions.clientCountryName);
    const timestamps = spreadWithinHour(hourIso, visits);
    for (let i = 0; i < visits; i++) {
      rows.push({
        slug: args.slug,
        visitor_hash: syntheticVisitorHash(
          args.hostname,
          hourIso,
          bucket.dimensions.clientCountryName,
          i,
        ),
        referrer_host: null,
        referrer_url: null,
        country,
        region: null,
        city: null,
        device: "desktop",
        browser: "Other",
        os: "Other",
        path: "/",
        ts: timestamps[i] ?? Date.now(),
        served_hostname: args.hostname,
        is_custom_domain: isCustom ? 1 : 0,
        utm_source: null,
        utm_medium: null,
        utm_campaign: null,
      });
    }
  }
  return rows;
}

// ─── SQL emission ──────────────────────────────────────────────────────

function sqlEscape(v: string | number | null): string {
  if (v === null) return "NULL";
  if (typeof v === "number") return String(v);
  return `'${v.replace(/'/g, "''")}'`;
}

function rowsToSql(rows: ViewEventRow[]): string {
  const lines: string[] = [];
  lines.push(`-- gitshow: imported from Cloudflare GraphQL Analytics`);
  lines.push(`-- Generated at: ${new Date().toISOString()}`);
  lines.push(`-- Total rows: ${rows.length}`);
  lines.push(``);
  lines.push(`BEGIN TRANSACTION;`);
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values = chunk
      .map(
        (r) =>
          `(${[
            sqlEscape(r.slug),
            sqlEscape(r.visitor_hash),
            sqlEscape(r.referrer_host),
            sqlEscape(r.referrer_url),
            sqlEscape(r.country),
            sqlEscape(r.region),
            sqlEscape(r.city),
            sqlEscape(r.device),
            sqlEscape(r.browser),
            sqlEscape(r.os),
            sqlEscape(r.path),
            sqlEscape(r.ts),
            sqlEscape(r.served_hostname),
            sqlEscape(r.is_custom_domain),
            sqlEscape(r.utm_source),
            sqlEscape(r.utm_medium),
            sqlEscape(r.utm_campaign),
          ].join(",")})`,
      )
      .join(",\n  ");
    lines.push(
      `INSERT INTO view_events (slug, visitor_hash, referrer_host, referrer_url, country, region, city, device, browser, os, path, ts, served_hostname, is_custom_domain, utm_source, utm_medium, utm_campaign) VALUES`,
    );
    lines.push(`  ${values};`);
  }
  lines.push(`COMMIT;`);
  return lines.join("\n");
}

// ─── Main ──────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();
  console.error(
    `Importing ${args.hostname} → slug=${args.slug}, last ${args.days}d`,
  );

  const buckets = await fetchCfBuckets(args);
  console.error(`Cloudflare returned ${buckets.length} buckets`);

  const rows = bucketsToRows(buckets, args);
  const totalVisits = rows.length;
  const distinctCountries = new Set(rows.map((r) => r.country).filter(Boolean))
    .size;
  console.error(`Generated ${totalVisits} synthetic view_events rows`);
  console.error(`Spanning ${distinctCountries} countries`);

  if (totalVisits === 0) {
    console.error("Nothing to import. Exiting.");
    process.exit(0);
  }

  const sql = rowsToSql(rows);
  if (args.dryRun) {
    console.log(sql);
    return;
  }
  const out = join(process.cwd(), args.outFile);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, sql, "utf8");
  console.error(`Wrote ${out}`);
  console.error(`Apply with:`);
  console.error(
    `  bunx wrangler d1 execute gitshow-db --remote --file=${args.outFile}`,
  );
}

main().catch((err) => {
  console.error("Import failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
