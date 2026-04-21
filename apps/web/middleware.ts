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
 * Strategy: for each protected path, make an internal fetch to
 * `/api/auth/get-session` forwarding the request's cookies. Better
 * Auth tells us whether the session is still live. If not, bounce to
 * /signin. We avoid importing `initAuth()` directly here — the Edge
 * runtime won't eval the D1 binding at middleware time, and direct
 * server-side invocation from middleware on OpenNext is known-flaky.
 *

 * Protected paths:
 *   /app and /app/** — the authenticated dashboard + editor
 *
 * Everything else (/, /signin, /{handle}, /api/**) stays open.
 * Per-route `getSession()` still runs in server components for the
 * belt-and-braces layer.
 */

const PROTECTED_PREFIXES = ["/app"] as const;

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
  if (!isProtected) return NextResponse.next();

  const cookie = request.headers.get("cookie") ?? "";
  if (!cookie.includes("gitshow.session_token")) {
    // Fast path: no session cookie, definitely signed out. Skip the
    // internal fetch.
    return redirectToSignin(request);
  }

  try {
    const sessionRes = await fetch(
      new URL("/api/auth/get-session", request.url),
      {
        method: "GET",
        headers: { cookie },
        // Do NOT cache — session validity is per-request.
        cache: "no-store",
      },
    );

    if (!sessionRes.ok) return redirectToSignin(request);

    const data = (await sessionRes.json().catch(() => null)) as {
      session?: unknown;
      user?: unknown;
    } | null;

    if (!data?.session || !data?.user) return redirectToSignin(request);

    return NextResponse.next();
  } catch {
    // On transient failure, don't hard-block — bouncing every request
    // to /signin during a Better Auth hiccup would be a worse UX than
    // letting the server component's own `getSession()` call re-check.
    return NextResponse.next();
  }
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
