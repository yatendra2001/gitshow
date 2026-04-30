import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { isReservedHandle } from "@/lib/profiles";
import {
  geoFromContext,
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
 * Visitor identity: a first-party `gs_v` cookie (random 12-byte hex,
 * 1-year TTL) — minted on first hit, refreshed on every hit. Cookies
 * are scoped per host, so a visit to gitshow.io/{handle} and a visit
 * to the user's custom domain produce different IDs (intentional —
 * they're separate "channels"). The cookie is httpOnly + sameSite=lax
 * so it's invisible to page JS and travels only with normal navigation.
 *
 * Why not IP+UA hash? The legacy hash collapsed every visitor behind
 * the same CG-NAT (Jio/Airtel/etc.) into one bucket — a profile with
 * 100 distinct India visitors would show ~5 uniques. The cookie ID is
 * per-browser, so it survives IP changes (carrier hand-off, VPN) AND
 * separates visitors behind shared NAT. Pre-cookie rows keep their
 * old hashes; queries DISTINCT-count both styles in the same column.
 *
 * No auth, no dedup at the API layer — uniques are computed at read
 * time via DISTINCT visitor_hash. Bots are tagged but still recorded;
 * the dashboard can filter them out at read time if we want a clean
 * "human views" line.
 */

/**
 * Read the `gs_v` cookie if present and well-formed, otherwise mint a
 * fresh random 12-byte (24 hex) ID. Returned as `{ id, isNew }` so the
 * caller can decide whether the response needs a Set-Cookie header
 * (always — we refresh expiry on every hit) and so logs / future
 * abuse-detection can distinguish first-visit traffic.
 */
function readOrMintVisitorId(req: Request): { id: string; isNew: boolean } {
  const cookieHeader = req.headers.get("cookie") ?? "";
  const m = /(?:^|;\s*)gs_v=([a-f0-9]{24})(?:;|$)/i.exec(cookieHeader);
  if (m) return { id: m[1]!.toLowerCase(), isNew: false };
  const buf = new Uint8Array(12);
  crypto.getRandomValues(buf);
  const id = Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
  return { id, isNew: true };
}

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

  // Visitor identity is decided BEFORE the DB write so we can also
  // attach the cookie to the response on the catch path — a failed
  // INSERT shouldn't force the visitor to mint a fresh ID next time.
  const visitor = readOrMintVisitorId(req);

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

    const visitorHash = visitor.id;

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
    // Never 500 a view-tracking request — it's best-effort. Fall
    // through so the response below still sets the visitor cookie.
  }

  // Always (re)set the cookie. Refreshing on every hit keeps active
  // visitors tracked indefinitely; idle visitors expire after a year.
  const res = NextResponse.json({ ok: true });
  res.cookies.set("gs_v", visitor.id, {
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    httpOnly: true,
    secure: true,
    path: "/",
  });
  return res;
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
