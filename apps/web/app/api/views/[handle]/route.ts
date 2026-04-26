import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { isReservedHandle } from "@/lib/profiles";
import {
  clientIp,
  geoFromContext,
  hashVisitor,
  normalizeReferrer,
  parseUserAgent,
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
    const ref = normalizeReferrer(referer, selfHost);

    // path here = the source path the visitor came from (the public
    // portfolio route), not /api/views. The browser sends a JSON body
    // with the path on POST; we accept it but tolerate missing.
    let path: string | null = null;
    try {
      const body = (await req.clone().json().catch(() => null)) as {
        path?: string;
      } | null;
      if (body?.path && typeof body.path === "string") {
        path = body.path.slice(0, 256);
      }
    } catch {
      path = null;
    }

    await env.DB.prepare(
      `INSERT INTO view_events
         (slug, visitor_hash, referrer_host, referrer_url,
          country, region, city, device, browser, os, path, ts)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        slug,
        visitorHash,
        ref.host,
        ref.url,
        country,
        region,
        city,
        device,
        browser,
        os,
        path,
        Date.now(),
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
