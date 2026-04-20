import NextAuth from "next-auth";
import authConfig from "./auth.config";

/**
 * Activates the `authorized` callback defined in auth.config.ts on
 * every request that matches the config.matcher below. Without this
 * file, /app / /s/<id> / /dashboard are all reachable by signed-out
 * users — the server component's own `auth()` check eventually
 * redirects, but in the meantime cached / stale pages leak through.
 *
 * Public routes ( /, /signin, /{handle}, /s/demo, static assets, API
 * auth routes ) are excluded via the matcher so the middleware stays
 * a thin guard on the authenticated surface only.
 */
export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  matcher: [
    /*
     * Match all paths EXCEPT:
     *   - /api/auth/**   (NextAuth's own endpoints)
     *   - /_next/**      (Next.js internals)
     *   - /signin
     *   - static assets  (svg / png / etc.)
     *
     * Public profile at /{handle} and /s/demo are gated per-path
     * inside auth.config.ts `authorized()` which returns true for
     * anything that isn't in the isProtected list.
     */
    "/((?!api/auth|_next/static|_next/image|signin|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|gif|avif|woff2?|ttf|eot|otf|css|js|map)$).*)",
  ],
};
