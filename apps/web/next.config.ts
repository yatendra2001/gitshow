import type { NextConfig } from "next";
import path from "node:path";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

/**
 * Next 16 configuration tuned for deployment on Cloudflare Workers via
 * `@opennextjs/cloudflare`. Keep this minimal — OpenNext handles the
 * heavy transform during `opennextjs-cloudflare build`.
 */
const nextConfig: NextConfig = {
  // Pin turbopack at the monorepo root so it picks up `bun.lock`, not
  // whatever lockfile Next stumbles on in parent directories.
  turbopack: {
    root: path.resolve(__dirname, "../.."),
  },
  // Treat workspace packages as transpile-in-place so Next bundles the
  // raw TypeScript from `@gitshow/shared` instead of expecting a prebuild.
  transpilePackages: ["@gitshow/shared"],
  experimental: {
    // Tells Next to tree-shake these packages aggressively (only the
    // sub-modules you actually import end up in the bundle). The win
    // is largest for barrel-export packages that re-export hundreds
    // of components — without this, importing one icon or one chart
    // pulls the whole namespace into the route.
    //
    // Picks here:
    //   - lucide-react / @hugeicons — icon barrels, used everywhere
    //   - recharts — chart primitives barrel
    //   - motion — used in 28 places across templates + marketing
    //   - react-simple-maps / d3-geo — map deps, only used on /app
    //   - react-markdown — only used by some templates and /blog/*
    optimizePackageImports: [
      "lucide-react",
      "recharts",
      "motion",
      "react-simple-maps",
      "d3-geo",
      "react-markdown",
      "@hugeicons/react",
      "@hugeicons/core-free-icons",
    ],
    // Client-side Router Cache lifetime. Next 15 reset the default
    // for `dynamic` routes to 0s — meaning every revisit to a
    // `force-dynamic` page (and we have those across the dashboard)
    // re-fetches the RSC payload AND re-shows the loading skeleton.
    // That's why navigating Edit → Preview → Edit felt fresh on
    // every click instead of snapping back from cache.
    //
    // Bumping `dynamic` to 60s gives sub/profile/analytics-style
    // pages a generous "feels instant" window while still
    // revalidating for users who linger on a tab. Mutations
    // (publish, save, sign-out) call `router.refresh()` and bypass
    // this cache, so freshness on actual changes is preserved.
    staleTimes: {
      dynamic: 60,
      static: 300,
    },
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
      // Marketing landing: template stub imagery. Swap out when we ship real
      // testimonials + screenshots.
      { protocol: "https", hostname: "randomuser.me" },
      { protocol: "https", hostname: "images.unsplash.com" },
    ],
  },
};

// Expose Cloudflare bindings to `next dev` via `getCloudflareContext()`.
// Harmless no-op in production.
initOpenNextCloudflareForDev();

export default nextConfig;
