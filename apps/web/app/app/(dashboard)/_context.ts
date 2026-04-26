import "server-only";
import { cache } from "react";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getSession } from "@/auth";
import { getSubscription, isActive } from "@/lib/entitlements";

/**
 * Per-request bundle for the dashboard route group.
 *
 * The layout needs handle / plan / public_slug / isPublished to render
 * the sidebar, and the page needs the same data + subscription state
 * to decide which surface (analytics, onboarding, draft-review,
 * upgrade) to show. Wrapping the loader in `React.cache` deduplicates
 * the D1 calls so layout + page only hit the database once.
 */

export interface DashboardProfileRow {
  handle: string;
  public_slug: string;
  last_scan_at: number | null;
  view_count: number | null;
  current_profile_r2_key: string | null;
}

export interface DashboardContext {
  userId: string;
  /** GitHub login from the session (used for sidebar / public URL). */
  handle: string;
  /** Avatar URL from the GitHub OAuth profile (sidebar avatar). */
  avatarUrl: string | null;
  isPro: boolean;
  /** Plan label for the sidebar avatar card. */
  planLabel: string;
  subscriptionStatus: string | null;
  profile: DashboardProfileRow | null;
  isPublished: boolean;
}

export const loadDashboardContext = cache(
  async (): Promise<DashboardContext | null> => {
    const session = await getSession();
    if (!session?.user?.id) return null;

    const userId = session.user.id;
    const handle = (session.user.login ?? session.user.name ?? "").trim();

    const { env } = await getCloudflareContext({ async: true });
    const [subscription, profile] = await Promise.all([
      getSubscription(env.DB, userId),
      env.DB.prepare(
        `SELECT handle, public_slug, last_scan_at, view_count,
                current_profile_r2_key
           FROM user_profiles WHERE user_id = ? LIMIT 1`,
      )
        .bind(userId)
        .first<DashboardProfileRow>(),
    ]);

    const isPro = isActive(subscription);
    const planLabel = isPro
      ? subscription?.interval === "Year"
        ? "Pro · Annual"
        : "Pro"
      : subscription?.status === "cancelled"
        ? "Free · Past Pro"
        : "Free";

    return {
      userId,
      handle,
      avatarUrl: session.user.image ?? null,
      isPro,
      planLabel,
      subscriptionStatus: subscription?.status ?? null,
      profile: profile ?? null,
      isPublished: Boolean(profile?.current_profile_r2_key),
    };
  },
);
