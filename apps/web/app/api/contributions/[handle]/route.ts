import { NextResponse } from "next/server";

/**
 * GET /api/contributions/{handle} — proxy + edge cache the public
 * GitHub contribution graph for `handle`. Used by the live trend chart
 * embedded in every public template (Classic, Minimal, Terminal, …).
 *
 * Upstream is the well-known jogruber/github-contributions-api which
 * scrapes github.com and exposes per-day { date, count, level } plus
 * per-year totals. We don't expose a token, so private contributions
 * are visible only when the user has opted in via GitHub settings.
 *
 * Response shape (passthrough):
 *   {
 *     total: { "2023": 388, "2024": 971, ... },
 *     contributions: [{ date: "YYYY-MM-DD", count, level }, ...]
 *   }
 *
 * Cache: s-maxage=300, stale-while-revalidate=3600. The graph updates
 * within hours of a commit upstream, so per-edge 5-min freshness keeps
 * portfolios live without hammering the upstream service.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ handle: string }> },
) {
  const { handle } = await params;
  const sanitized = (handle ?? "").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 39);
  if (!sanitized) {
    return NextResponse.json({ error: "invalid_handle" }, { status: 400 });
  }

  try {
    const upstream = `https://github-contributions-api.jogruber.de/v4/${encodeURIComponent(sanitized)}?y=all`;
    const r = await fetch(upstream, {
      headers: {
        accept: "application/json",
        "user-agent": "gitshow-contrib-trend/1",
      },
      // Cloudflare worker fetch supports `cf` but Next.js types won't
      // know about it — the cast keeps the runtime hint while the
      // outer Cache-Control header below is what browsers/CDN see.
      ...({
        cf: { cacheTtl: 600, cacheEverything: true },
      } as Record<string, unknown>),
    });
    if (!r.ok) {
      return NextResponse.json(
        { error: "upstream_failed", status: r.status },
        { status: 502 },
      );
    }
    const data = await r.json();
    return new NextResponse(JSON.stringify(data), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control":
          "public, max-age=120, s-maxage=300, stale-while-revalidate=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "fetch_failed" }, { status: 502 });
  }
}
