import type { NextAuthConfig } from "next-auth";
import GitHub from "next-auth/providers/github";

/**
 * Edge-safe Auth.js config. Does NOT touch the D1 adapter — proxy.ts
 * imports this and runs in the middleware-lite "proxy" runtime where
 * Cloudflare bindings aren't available at module eval. The real adapter
 * is wired lazily inside auth.ts.
 *
 * Protected route gate: /dashboard/** and /s/** (the builder) require
 * a session. Public marketing pages (/, /signin) and /p/[handle] (the
 * shareable profile view) stay open.
 */
export default {
  providers: [GitHub],
  pages: { signIn: "/signin" },
  callbacks: {
    authorized({ auth, request }) {
      const path = request.nextUrl.pathname;
      const isProtected =
        path.startsWith("/dashboard") ||
        (path.startsWith("/s/") && path !== "/s/demo");
      if (!isProtected) return true;
      return !!auth?.user;
    },
  },
} satisfies NextAuthConfig;
