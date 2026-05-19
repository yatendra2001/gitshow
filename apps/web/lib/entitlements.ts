import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getSession, type AppSession } from "@/auth";

/**
 * Billing entitlements. Single source of truth for "does this user
 * have access to Pro features right now?".
 *
 * Design:
 *   - Reads the locally-cached `subscription` table, populated by the
 *     webhook sync in lib/billing-sync.ts. No Dodo REST calls on the
 *     request path — gating is a single indexed query.
 *   - "Has Pro" means: there's a row for the user where the paid
 *     period hasn't ended yet AND status is one of the live states.
 *     A cancelled user keeps Pro until their period_end (we
 *     configured cancel-at-period-end); after that they're shown the
 *     paywall but keep their public profile (read-only).
 *   - `requirePro()` is the guard for Server Components + route
 *     handlers: returns the session if Pro, otherwise a redirect /
 *     402 response the caller can hand straight to Next.
 *   - All read paths (`getSubscription`, `requireProPage`,
 *     `requireProApi`, `getProOrNull`) share a `React.cache()` so the
 *     dashboard layout + page + pro-gate all collapse to one D1
 *     roundtrip per request. Without this, every nav between
 *     /app/edit ↔ /app/preview ↔ /app/resume paid for the
 *     subscription row twice (layout once, page once).
 */

export interface SubscriptionRow {
  id: string;
  user_id: string;
  customer_id: string;
  product_id: string;
  status: string;
  interval: string | null;
  amount_cents: number | null;
  currency: string | null;
  current_period_end: number;
  cancel_at_period_end: number;
  cancelled_at: number | null;
  created_at: number;
  updated_at: number;
}

const ACTIVE_STATUSES = new Set(["active", "cancelled", "on_hold"]);

/**
 * Raw, UNCACHED read of the user's effective subscription row.
 *
 * Most callers want `getSubscription` (the `React.cache` wrapper).
 * This exists for the one place that needs to read *after* mutating
 * the row inside the same request — the on-read resync on
 * /app/billing pulls fresh state from Dodo and must then re-read it;
 * going through the memoized wrapper would hand back the pre-resync
 * value. SQL lives here once so the two never drift.
 */
export async function querySubscription(
  db: D1Database,
  userId: string,
): Promise<SubscriptionRow | null> {
  const row = await db
    .prepare(
      `SELECT id, user_id, customer_id, product_id, status, interval,
              amount_cents, currency, current_period_end,
              cancel_at_period_end, cancelled_at, created_at, updated_at
         FROM subscription
        WHERE user_id = ?
        ORDER BY current_period_end DESC
        LIMIT 1`,
    )
    .bind(userId)
    .first<SubscriptionRow>();
  return row ?? null;
}

/**
 * Wrapped in `React.cache` so layout + page + pro-gate, all of which
 * resolve subscription state during the same request, share one
 * D1 query. `cache()` keys by argument identity — `db` is stable per
 * isolate and `userId` is a string, so two callers with the same
 * userId hit the cache.
 */
export const getSubscription = cache(querySubscription);

/**
 * True if the user has current access to Pro features.
 *
 * Allows:
 *   - active (paying)
 *   - cancelled but within paid period (cancel-at-period-end)
 *   - on_hold within paid period (Dodo retries the renewal charge
 *     for up to a few days — don't pull the rug mid-retry)
 *
 * Denies:
 *   - no row at all (never paid)
 *   - expired / failed
 *   - any status once `current_period_end` has passed
 */
export function isActive(sub: SubscriptionRow | null): boolean {
  if (!sub) return false;
  if (!ACTIVE_STATUSES.has(sub.status)) return false;
  return sub.current_period_end > Date.now();
}

export async function hasPro(
  db: D1Database,
  userId: string,
): Promise<boolean> {
  const sub = await getSubscription(db, userId);
  return isActive(sub);
}

/**
 * Free-tier scan quota. The hosted portfolio is free — but a scan
 * spends real money (~$10 of Fly + OpenRouter per run), so a non-Pro
 * account gets exactly ONE successful generation, ever.
 *
 * A scan is "spent" the moment it's queued and stays spent once it
 * succeeds. We count `queued` + `running` too so a free user can't
 * fan out ten concurrent scans before the first one flips to
 * `succeeded` (each would have been $10). Only `failed` / `cancelled`
 * scans don't count — a run that produced nothing shouldn't burn the
 * one free generation.
 *
 * Pro is unlimited and short-circuits before this is ever called.
 */
export const countBillableScans = cache(
  async (db: D1Database, userId: string): Promise<number> => {
    const row = await db
      .prepare(
        `SELECT COUNT(*) AS n
           FROM scans
          WHERE user_id = ?
            AND status IN ('queued','running','succeeded')`,
      )
      .bind(userId)
      .first<{ n: number }>();
    return row?.n ?? 0;
  },
);

export async function canRunFreeScan(
  db: D1Database,
  userId: string,
): Promise<boolean> {
  return (await countBillableScans(db, userId)) === 0;
}

/**
 * Guard for the scan-spawning endpoints (`/api/scan`,
 * `/api/intake`, `/api/intake/[id]/answers`). Unlike `requireProApi`,
 * this lets a signed-in free user through for their first generation.
 *
 *   - signed out          → 401
 *   - Pro                 → ok (unlimited re-scans)
 *   - free, no prior scan → ok (the one free generation)
 *   - free, scan spent    → 402 `free_scan_used` + upgrade_url
 */
export async function requireScanQuota(): Promise<
  | { ok: true; session: AppSession; isPro: boolean }
  | { ok: false; response: NextResponse }
> {
  const session = await getSession();
  if (!session?.user?.id) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "unauthenticated" },
        { status: 401 },
      ),
    };
  }
  const { env } = await getCloudflareContext({ async: true });
  const subscription = await getSubscription(env.DB, session.user.id);
  if (isActive(subscription)) {
    return { ok: true, session, isPro: true };
  }
  if (await canRunFreeScan(env.DB, session.user.id)) {
    return { ok: true, session, isPro: false };
  }
  return {
    ok: false,
    response: NextResponse.json(
      {
        error: "free_scan_used",
        message:
          "You've used your free portfolio. Upgrade to Pro to refresh it anytime.",
        upgrade_url: "/pricing",
      },
      { status: 402 },
    ),
  };
}

/**
 * Owner Pro check for the public `/{handle}` route, used to decide
 * whether to render the "Built with GitShow" badge. Resolves the
 * profile's owning user via `user_profiles.public_slug` (the stable
 * lowercased handle) and reuses the cached subscription read.
 *
 * Returns false for unknown handles — a not-yet-claimed page is, by
 * definition, not a paying customer's, so the badge (which only ever
 * shows on a real published page) is moot there anyway.
 */
export async function isHandleOwnerPro(
  db: D1Database,
  handle: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT user_id FROM user_profiles WHERE public_slug = ? LIMIT 1`,
    )
    .bind(handle.toLowerCase())
    .first<{ user_id: string }>();
  if (!row?.user_id) return false;
  return hasPro(db, row.user_id);
}

export type ProGuardFailure =
  | { kind: "unauthenticated" }
  | { kind: "no_subscription" };

/**
 * For API route handlers. Returns either `{ ok: true, session, sub }`
 * with a live Pro session, or `{ ok: false, response }` — a ready-made
 * NextResponse the caller can return directly.
 *
 *   const gate = await requireProApi();
 *   if (!gate.ok) return gate.response;
 *   // ... run the handler with gate.session / gate.sub
 */
export async function requireProApi(): Promise<
  | {
      ok: true;
      session: AppSession;
      subscription: SubscriptionRow;
    }
  | { ok: false; response: NextResponse }
> {
  const session = await getSession();
  if (!session?.user?.id) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "unauthenticated" },
        { status: 401 },
      ),
    };
  }
  const { env } = await getCloudflareContext({ async: true });
  const subscription = await getSubscription(env.DB, session.user.id);
  if (!isActive(subscription)) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "payment_required",
          message: "An active Pro subscription is required.",
          upgrade_url: "/pricing",
        },
        { status: 402 },
      ),
    };
  }
  return { ok: true, session, subscription: subscription! };
}

/**
 * Server-component variant. Returns the session+sub if Pro, or null
 * if the page should render the paywall/showcase state instead. The
 * caller decides what to render — this helper doesn't redirect.
 */
export async function getProOrNull(): Promise<
  { session: AppSession; subscription: SubscriptionRow } | null
> {
  const session = await getSession();
  if (!session?.user?.id) return null;
  const { env } = await getCloudflareContext({ async: true });
  const subscription = await getSubscription(env.DB, session.user.id);
  if (!isActive(subscription)) return null;
  return { session, subscription: subscription! };
}

/**
 * Server-component guard for deep /app/* routes (scan, edit, preview,
 * intake). Bounces the user to /signin if signed out, to /pricing if
 * signed in without Pro. Returns the live session when access is ok.
 *
 * /app (the root) and /app/billing intentionally DON'T use this —
 * they render their own paywall/billing states for non-Pro users.
 */
export async function requireProPage(): Promise<AppSession> {
  const session = await getSession();
  if (!session?.user?.id) redirect("/signin");
  const { env } = await getCloudflareContext({ async: true });
  const subscription = await getSubscription(env.DB, session.user.id);
  if (!isActive(subscription)) redirect("/pricing");
  return session;
}
