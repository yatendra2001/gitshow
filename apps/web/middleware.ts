import { NextResponse, type NextRequest } from "next/server";

/**
 * Session-gated middleware. Runs in the Edge/Workers runtime before
 * every request that matches `config.matcher`. This file was MISSING
 * under Auth.js and is why signing out "didn't stick" even when
 * /api/auth/signout succeeded: no middleware meant no route-level
 * session enforcement, so stale RSC payloads would still render.
 *
 * Why not proxy.ts: Next 16 renamed middleware → proxy, but the
 * OpenNext Cloudflare adapter doesn't support the proxy convention
 * yet (opennextjs-cloudflare#962) and Next itself refuses to accept
 * runtime: "edge" on a proxy export. Sticking with middleware.ts
 * keeps both sides happy. When OpenNext ships proxy support we can
 * rename back.
 *
 * Strategy: cookie-presence fast path only. Validating the session
 * properly (signature + DB row) used to live here behind an internal
 * fetch to /api/auth/get-session, but that round-trip cost 50–200ms
 * on EVERY /app/* navigation — including soft RSC fetches when
 * clicking sidebar links. The dashboard layout already calls
 * `getSession()` (cache-wrapped) and `redirect("/signin")` on a null
 * session, so:
 *
 *   - Forged or expired cookie → middleware lets the request through,
 *     layout's `getSession()` returns null, layout redirects. Same
 *     end state, no extra latency.
 *   - Sign-out → cookie cleared by Better Auth handler. Next nav has
 *     no session_token cookie → middleware redirects to /signin
 *     immediately (no fetch needed).
 *
 * The only behaviour we lose is "block stale-but-validly-signed
 * cookies at the edge" — but the layer below catches them in <5ms,
 * which is invisible compared to the 50–200ms we used to add.
 *
 * Protected paths:
 *   /app and /app/** — the authenticated dashboard + editor
 *
 * Everything else (/, /signin, /{handle}, /api/**) stays open.
 * Per-route `getSession()` still runs in server components for the
 * belt-and-braces layer.
 */

const PROTECTED_PREFIXES = ["/app"] as const;

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
  if (!isProtected) return NextResponse.next();

  const cookie = request.headers.get("cookie") ?? "";
  if (!cookie.includes("gitshow.session_token")) {
    return redirectToSignin(request);
  }

  // Has cookie → trust it past the edge. Layout will validate.
  return NextResponse.next();
}

function redirectToSignin(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = "/signin";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/app/:path*"],
};
