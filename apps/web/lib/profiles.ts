/**
 * Reserved-handle guard for the public `/{handle}` route.
 *
 * Next.js resolves static routes before dynamic ones, so `/app` / `/api`
 * / `/signin` / etc. won't accidentally match the `[handle]` segment.
 * This list is defence-in-depth: if a bad deploy removes a static
 * route, we still refuse to render the claim-catch-all page for a
 * reserved word.
 */

export const RESERVED_PATHS = new Set([
  "api",
  "app",
  "auth",
  "dashboard",
  "docs",
  "help",
  "legal",
  "login",
  "logout",
  "oauth",
  "p",
  "privacy",
  "pricing",
  "public",
  "s",
  "settings",
  "sign-in",
  "sign-out",
  "signin",
  "signout",
  "signup",
  "static",
  "support",
  "terms",
  "_next",
  "_vercel",
  "favicon.ico",
  "robots.txt",
  "sitemap.xml",
  "sw.js",
  "manifest.json",
]);

export function isReservedHandle(handle: string): boolean {
  return RESERVED_PATHS.has(handle.toLowerCase());
}
