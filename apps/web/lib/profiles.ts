/**
 * Public profile lookup.
 *
 * Reads (user_profiles row) + (the current_profile_r2_key from R2) and
 * returns a ready-to-render ProfileCard plus the public slug. Cached at
 * the edge via CDN headers on the /{handle} route — not here.
 */

import type { ProfileCard } from "@gitshow/shared/schemas";

export interface UserProfileRow {
  user_id: string;
  handle: string;
  public_slug: string;
  current_scan_id: string | null;
  current_profile_r2_key: string | null;
  first_scan_at: number | null;
  last_scan_at: number | null;
  revision_count: number;
  created_at: number;
  updated_at: number;
}

export async function getProfileBySlug(
  db: D1Database,
  bucket: R2Bucket | undefined,
  slugRaw: string,
): Promise<{ row: UserProfileRow; card: ProfileCard } | null> {
  const slug = slugRaw.toLowerCase();
  const row = await db
    .prepare(
      `SELECT * FROM user_profiles WHERE public_slug = ? OR LOWER(handle) = ? LIMIT 1`,
    )
    .bind(slug, slug)
    .first<UserProfileRow>();
  if (!row) return null;
  if (!row.current_profile_r2_key || !bucket) return null;
  try {
    const obj = await bucket.get(row.current_profile_r2_key);
    if (!obj) return null;
    const text = await obj.text();
    const card = JSON.parse(text) as ProfileCard;
    return { row, card };
  } catch {
    return null;
  }
}

/**
 * Reserved-word list. Anything in this set must not be routable as a
 * public profile. The /{handle} catch-all page checks this before
 * attempting a D1 lookup, so we never fall through to "profile not
 * found" on a real internal route.
 *
 * Kept deliberately short — Next.js's route-resolution already gives
 * static routes priority over dynamic ones, but we defend in depth so
 * a bad deploy (e.g. a missing static page) can't match a random user
 * handle.
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
