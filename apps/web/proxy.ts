import NextAuth from "next-auth";
import authConfig from "./auth.config";

/**
 * Next.js 16 proxy (formerly middleware.ts) — activates the
 * `authorized` callback in auth.config.ts on every request matching
 * the config.matcher below. Without this file, /app / /s/<id> /
 * /dashboard are all reachable by signed-out users — the server
 * component's own `auth()` check eventually redirects, but the
 * page renders once before the redirect lands.
 *
 * Public routes (/, /signin, /{handle}, /s/demo, static assets, API
 * auth routes) are excluded via the matcher so this guard stays
 * scoped to the authenticated surface only.
 */
const { auth } = NextAuth(authConfig);

export default auth;

export const config = {
  matcher: [
    /*
     * Match all paths EXCEPT:
     *   - /api/auth/**   (NextAuth's own endpoints)
     *   - /_next/**      (Next.js internals)
     *   - /signin
     *   - static assets  (svg / png / etc.)
     *
     * Public profile at /{handle} and /s/demo return early via
     * auth.config.ts `authorized()` which treats anything not in
     * isProtected as open.
     */
    "/((?!api/auth|_next/static|_next/image|signin|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|gif|avif|woff2?|ttf|eot|otf|css|js|map)$).*)",
  ],
};
