import NextAuth from "next-auth";
import authConfig from "./auth.config";

/**
 * Next 16 renamed `middleware.ts` → `proxy.ts`. The exported function
 * is named `proxy` (either default or named export). Runs before every
 * matching request and redirects unauthenticated users to /signin via
 * the `authorized` callback in auth.config.
 *
 * We use the edge-safe `authConfig` (no D1 adapter) because this runs
 * before the Cloudflare async context is fully established. Heavy auth
 * (DB lookups, adapter calls) happens in server components.
 */
const { auth } = NextAuth(authConfig);

export const proxy = auth;

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     *   - _next (Next internals)
     *   - static assets (images, fonts)
     *   - api/auth (NextAuth's own handlers)
     *   - api/ws (WebSocket upgrade path — its own auth check)
     *   - favicon.ico
     */
    "/((?!api/auth|api/ws|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|woff|woff2|ttf|eot)).*)",
  ],
};
