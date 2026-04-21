import type { MetadataRoute } from "next";
import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Dynamic sitemap. Lists every published portfolio plus its blog index
 * and every blog-post page. Runs on-demand at `/sitemap.xml` — Next
 * caches it aggressively so a D1 scan per request isn't an issue under
 * normal traffic.
 */

export const dynamic = "force-dynamic";

interface ProfileSlim {
  handle: string;
  public_slug: string;
  updated_at: number | null;
}

interface BlogPost {
  slug: string;
  publishedAt?: string;
  updatedAt?: string;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "https://gitshow.io").replace(
    /\/+$/,
    "",
  );

  const entries: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified: new Date(), changeFrequency: "weekly", priority: 1 },
  ];

  try {
    const { env } = await getCloudflareContext({ async: true });
    const rows = await env.DB.prepare(
      `SELECT handle, public_slug, updated_at
         FROM user_profiles
         WHERE current_profile_r2_key IS NOT NULL
         ORDER BY updated_at DESC
         LIMIT 5000`,
    ).all<ProfileSlim>();

    for (const p of rows.results ?? []) {
      const lastMod = p.updated_at ? new Date(p.updated_at) : new Date();
      entries.push({
        url: `${base}/${p.public_slug}`,
        lastModified: lastMod,
        changeFrequency: "weekly",
        priority: 0.8,
      });

      // Blog list + posts — load published.json to enumerate posts.
      if (!env.BUCKET) continue;
      try {
        const obj = await env.BUCKET.get(
          `resumes/${p.handle.toLowerCase()}/published.json`,
        );
        if (!obj) continue;
        const text = await obj.text();
        const json = JSON.parse(text) as { blog?: BlogPost[] };
        const posts = Array.isArray(json.blog) ? json.blog : [];
        if (posts.length > 0) {
          entries.push({
            url: `${base}/${p.public_slug}/blog`,
            lastModified: lastMod,
            changeFrequency: "weekly",
            priority: 0.6,
          });
          for (const post of posts) {
            entries.push({
              url: `${base}/${p.public_slug}/blog/${post.slug}`,
              lastModified: post.updatedAt
                ? new Date(post.updatedAt)
                : post.publishedAt
                  ? new Date(post.publishedAt)
                  : lastMod,
              changeFrequency: "monthly",
              priority: 0.5,
            });
          }
        }
      } catch {
        // Bad published blob for one profile shouldn't tank the whole sitemap.
      }
    }
  } catch {
    // D1 or env not available — serve the base-only sitemap rather than 500.
  }

  return entries;
}
