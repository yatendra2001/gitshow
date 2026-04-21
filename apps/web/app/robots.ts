import type { MetadataRoute } from "next";

/**
 * robots.txt — crawlable public portfolios, disallow the app chrome
 * and any API surface. Matches the routes that actually exist after
 * the claim-era purge.
 */
export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://gitshow.io";
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/"],
        disallow: ["/app", "/app/", "/api", "/api/", "/signin", "/auth"],
      },
    ],
    sitemap: `${base.replace(/\/+$/, "")}/sitemap.xml`,
    host: base,
  };
}
