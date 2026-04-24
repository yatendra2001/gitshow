import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
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

export async function getSubscription(
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
