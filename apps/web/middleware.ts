import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge middleware. Two responsibilities, in order:
 *
 *   1. Custom-domain routing — when the request arrives on a hostname
 *      that isn't `gitshow.io`, look it up against the active set in
 *      D1 and rewrite the path to `/{handle}` so the existing public
 *      portfolio renderer takes over. Auth surfaces (sign-in, /app/*,
 *      /api/*) are 404'd on custom hostnames so we never leak session
 *      cookies cross-domain.
 *
 *   2. Session-gated /app/* — original behaviour, preserved.
 *
 * Performance: middleware runs on every request, so we never reach
 * D1 directly here. We use the Cloudflare cache (`caches.default`)
 * for hostname → slug, with a 30s TTL. Cache miss path uses an
 * internal RSC-friendly endpoint (`/api/_internal/route-host`) which
 * does the actual D1 hit.
 *
 * Why not edge `import` of D1? The Next.js middleware runtime can't
 * use `getCloudflareContext` because the OpenNext bridge attaches it
 * inside the worker handler, AFTER middleware. Calling fetch() to a
 * same-origin route handler IS supported, runs in the same isolate,
 * and lets us reuse all our existing D1 + auth infrastructure.
 */

const PROTECTED_PREFIXES = ["/app"] as const;

// Hostnames that always serve the canonical app — never routed as
// custom domains. Includes the apex + workers.dev preview + localhost.
const CANONICAL_HOSTS = new Set<string>([
  "gitshow.io",
  "www.gitshow.io",
  "localhost",
  "127.0.0.1",
]);

function isCanonical(host: string): boolean {
  if (CANONICAL_HOSTS.has(host)) return true;
  if (host.endsWith(".workers.dev")) return true;
  if (host.endsWith(".pages.dev")) return true;
  if (host.startsWith("localhost:") || host.startsWith("127.0.0.1:")) return true;
  return false;
}

export async function middleware(request: NextRequest) {
  const url = request.nextUrl;
  const host = (request.headers.get("host") ?? url.host).toLowerCase().replace(/:\d+$/, "");

  // ─── Custom-domain routing ─────────────────────────────────────
  if (!isCanonical(host)) {
    const path = url.pathname;
    // Read-only paths the portfolio actually serves. Block everything
    // auth-related on a custom hostname so cookies / OAuth / API can
    // never run there.
    if (
      path === "/api/views" ||
      path.startsWith("/api/views/") ||
      path === "/api/og" ||
      path.startsWith("/_next/") ||
      path === "/favicon.ico" ||
      path === "/robots.txt" ||
      path === "/sitemap.xml" ||
      path === "/manifest.json" ||
      path.startsWith("/r2/") ||
      // Reachability probe used by /api/domains/verify to confirm DNS
      // actually points at our worker (vs a stale origin from a prior
      // host). Pure JSON, no PII, identical for every caller.
      path === "/.well-known/gitshow-probe"
    ) {
      return NextResponse.next();
    }
    if (
      path.startsWith("/app") ||
      path.startsWith("/api") ||
      path === "/signin" ||
      path === "/signout" ||
      path === "/pricing"
    ) {
      // 404 — never expose auth surfaces on a customer's domain.
      return NextResponse.rewrite(new URL("/not-found", url));
    }

    const slug = await resolveHostToSlug(host, url.origin);
    if (!slug) {
      // Unknown hostname: rewrite to the marketing 404 page. The
      // request DID reach our worker (cf for SaaS routed it), but
      // we don't recognise it — could be a stale DNS pointing at us.
      return NextResponse.rewrite(new URL("/not-found", url));
    }

    // Rewrite root → /{slug}. Anything else (e.g. /resume) stays
    // unchanged but gets rewritten under the slug subtree.
    const target = path === "/" ? `/${slug}` : `/${slug}${path}`;
    const rewriteUrl = new URL(target + url.search, url);
    const res = NextResponse.rewrite(rewriteUrl);
    // Pass the served hostname downstream so view tracking can store it.
    res.headers.set("x-gs-served-hostname", host);
    res.headers.set("x-gs-custom-domain", "1");

    // ── Security headers, custom-domain pages only ─────────────
    // Strict CSP because we don't control the customer's brand
    // surface — defense-in-depth even if a markdown XSS slips in.
    // self + same-origin imgs (we serve OG / R2 from /r2 + /api/og).
    // No third-party scripts. No iframes. No mixed content.
    res.headers.set(
      "content-security-policy",
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'none'",
      ].join("; "),
    );
    res.headers.set("referrer-policy", "strict-origin-when-cross-origin");
    res.headers.set("x-content-type-options", "nosniff");
    res.headers.set("x-frame-options", "DENY");
    res.headers.set(
      "permissions-policy",
      "camera=(), microphone=(), geolocation=(), interest-cohort=()",
    );
    // SEO: tell search engines the canonical URL points to the custom
    // domain itself so we don't get duplicate-content penalties from
    // gitshow.io/{slug} also being indexed.
    res.headers.set("link", `<https://${host}${path === "/" ? "" : path}>; rel="canonical"`);
    // Vary by Host so any cache layer keeps custom domains separate.
    res.headers.append("vary", "Host");
    return res;
  }

  // ─── Canonical /app/* session gate (existing behaviour) ────────
  const { pathname } = url;
  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
  if (!isProtected) return NextResponse.next();

  const cookie = request.headers.get("cookie") ?? "";
  if (!cookie.includes("gitshow.session_token")) {
    const signin = url.clone();
    signin.pathname = "/signin";
    signin.search = "";
    return NextResponse.redirect(signin);
  }
  return NextResponse.next();
}

// ─── Lookup helper ────────────────────────────────────────────────────

async function resolveHostToSlug(host: string, origin: string): Promise<string | null> {
  const cacheKey = `https://gitshow-internal.invalid/host/${host}`;
  // Cloudflare runtime: caches.default is available; in dev/Vercel
  // the global may be undefined — fall back to direct fetch.
  const cache = (globalThis as { caches?: CacheStorage }).caches;
  if (cache && "default" in cache) {
    const hit = await (cache as unknown as { default: Cache }).default.match(cacheKey);
    if (hit) {
      const slug = await hit.text();
      return slug || null;
    }
  }
  let slug: string | null = null;
  try {
    const res = await fetch(`${origin}/api/_internal/route-host?h=${encodeURIComponent(host)}`, {
      headers: { "x-internal-route": "1" },
      // 1.5s budget — middleware is on the hot path.
      signal: AbortSignal.timeout(1500),
    });
    if (res.ok) {
      const json = (await res.json()) as { slug?: string | null };
      slug = json.slug ?? null;
    }
  } catch {
    slug = null;
  }
  if (cache && "default" in cache) {
    const ttl = slug ? 30 : 5; // brief negative-cache so a misconfigured CNAME doesn't hammer D1
    await (cache as unknown as { default: Cache }).default.put(
      cacheKey,
      new Response(slug ?? "", {
        headers: { "cache-control": `public, max-age=${ttl}` },
      }),
    );
  }
  return slug;
}

export const config = {
  // Match everything except internal Next.js asset paths.
  matcher: [
    "/((?!_next/static|_next/image|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|avif|mp4|webm|woff|woff2|ttf)).*)",
  ],
};
