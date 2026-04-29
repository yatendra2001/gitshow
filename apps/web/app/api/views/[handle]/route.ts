import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { isReservedHandle } from "@/lib/profiles";
import {
  clientIp,
  geoFromContext,
  hashVisitor,
  inAppBrowserHost,
  normalizeReferrer,
  parseUserAgent,
  utmHostFromPath,
} from "@/lib/visitor";

/**
 * POST /api/views/{handle} — fire-and-forget +1 for the handle's
 * published profile, plus a row in `view_events` for the analytics
 * dashboard at /app.
 *
 * Two writes:
 *   1) UPDATE user_profiles.view_count (cheap badge counter, kept for
 *      back-compat with anything reading that field).
 *   2) INSERT into view_events with enriched per-visit metadata —
 *      visitor hash, geo (from CF request props), parsed UA, and
 *      referrer host.
 *
 * No auth, no dedup at the API layer — uniques are computed at read
 * time via DISTINCT visitor_hash. Bots are tagged but still recorded;
 * the dashboard can filter them out at read time if we want a clean
 * "human views" line.
 */

export async function POST(
  req: Request,
  { params }: { params: Promise<{ handle: string }> },
) {
  const { handle } = await params;
  if (isReservedHandle(handle)) {
    return NextResponse.json({ error: "reserved" }, { status: 400 });
  }

  const { env, cf } = await getCloudflareContext({ async: true });
  const slug = handle.toLowerCase();

  try {
    // 1) Cheap badge counter — fast path.
    await env.DB.prepare(
      `UPDATE user_profiles
         SET view_count = view_count + 1
         WHERE public_slug = ? AND current_profile_r2_key IS NOT NULL`,
    )
      .bind(slug)
      .run();

    // 2) Enriched event row. Errors here must NEVER fail the page view,
    //    so the entire block is best-effort.
    const ua = req.headers.get("user-agent") ?? "";
    const referer = req.headers.get("referer");
    const url = new URL(req.url);
    const selfHost = url.host;

    const ip = clientIp(req);
    const salt = env.AUTH_SECRET ?? "gitshow-fallback-salt";
    const visitorHash = await hashVisitor(salt, ip, ua);

    const { country, region, city } = geoFromContext(cf, req.headers);
    const { device, browser, os } = parseUserAgent(ua);

    // Body: { path, referrer } — path tells us which portfolio route
    // they hit, referrer is `document.referrer` from the client (often
    // populated when the HTTP Referer header was stripped).
    let path: string | null = null;
    let clientReferrer: string | null = null;
    let bodyHostname: string | null = null;
    try {
      const body = (await req.clone().json().catch(() => null)) as {
        path?: string;
        referrer?: string;
        host?: string;
      } | null;
      if (body?.path && typeof body.path === "string") {
        path = body.path.slice(0, 256);
      }
      if (body?.referrer && typeof body.referrer === "string") {
        clientReferrer = body.referrer.slice(0, 512);
      }
      if (body?.host && typeof body.host === "string") {
        bodyHostname = body.host.slice(0, 253).toLowerCase();
      }
    } catch {
      // tolerate
    }

    // Pulled from the middleware — when set, the request landed on a
    // custom domain. We trust the middleware-injected value first, fall
    // back to body.host (set by TrackView), then to the request host.
    const middlewareHostname = req.headers.get("x-gs-served-hostname");
    const isCustomDomain = req.headers.get("x-gs-custom-domain") === "1";
    const servedHostname =
      middlewareHostname ??
      bodyHostname ??
      selfHost.toLowerCase();
    const isCustom = isCustomDomain
      ? 1
      : !servedHostname || /(^|\.)gitshow\.io$|workers\.dev$|localhost/.test(servedHostname)
        ? 0
        : 1;

    // UTM capture from the path's query string. We already canonicalize
    // utm_source to a host (referrer chain below); store the raw values
    // separately for campaign reporting.
    let utmSource: string | null = null;
    let utmMedium: string | null = null;
    let utmCampaign: string | null = null;
    if (path && path.includes("?")) {
      try {
        const u = new URL(path, "https://x.invalid");
        utmSource = (u.searchParams.get("utm_source") ?? "").slice(0, 64) || null;
        utmMedium = (u.searchParams.get("utm_medium") ?? "").slice(0, 64) || null;
        utmCampaign = (u.searchParams.get("utm_campaign") ?? "").slice(0, 64) || null;
      } catch {
        // tolerate
      }
    }

    // Referrer resolution chain (most explicit → most defensive):
    //   1. utm_source on the landing path (intentional sharing)
    //   2. HTTP Referer header (desktop + most mobile browsers)
    //   3. document.referrer from the client (some in-app browsers
    //      strip the HTTP header but populate the JS API)
    //   4. UA fingerprint for known in-app browsers (LinkedIn etc.)
    let refHost: string | null = utmHostFromPath(path);
    let refUrl: string | null = null;
    if (!refHost) {
      const fromHeader = normalizeReferrer(referer, selfHost);
      if (fromHeader.host) {
        refHost = fromHeader.host;
        refUrl = fromHeader.url;
      } else {
        const fromClient = normalizeReferrer(clientReferrer, selfHost);
        if (fromClient.host) {
          refHost = fromClient.host;
          refUrl = fromClient.url;
        } else {
          refHost = inAppBrowserHost(ua);
        }
      }
    }

    await env.DB.prepare(
      `INSERT INTO view_events
         (slug, visitor_hash, referrer_host, referrer_url,
          country, region, city, device, browser, os, path, ts,
          served_hostname, is_custom_domain, utm_source, utm_medium, utm_campaign)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        slug,
        visitorHash,
        refHost,
        refUrl,
        country,
        region,
        city,
        device,
        browser,
        os,
        path,
        Date.now(),
        servedHostname,
        isCustom,
        utmSource,
        utmMedium,
        utmCampaign,
      )
      .run();
  } catch {
    // Never 500 a view-tracking request — it's best-effort.
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ ok: true });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ handle: string }> },
) {
  const { handle } = await params;
  if (isReservedHandle(handle)) {
    return NextResponse.json({ views: 0 }, { status: 200 });
  }
  const { env } = await getCloudflareContext({ async: true });
  const slug = handle.toLowerCase();
  const row = await env.DB.prepare(
    `SELECT view_count FROM user_profiles
       WHERE public_slug = ? LIMIT 1`,
  )
    .bind(slug)
    .first<{ view_count: number }>();
  return NextResponse.json({ views: row?.view_count ?? 0 });
}
