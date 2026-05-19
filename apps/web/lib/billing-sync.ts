/**
 * Dodo Payments → D1 `subscription` table sync.
 *
 * Two write paths, one upsert:
 *
 *   1. PUSH — `syncSubscriptionFromWebhook()` runs from the
 *      `onPayload` callback inside the Better Auth Dodo plugin
 *      (auth.ts). The plugin verifies the webhook signature before we
 *      run — by the time a payload gets here it's authenticated.
 *
 *   2. PULL — `syncSubscriptionFromDodo()` fetches the live
 *      subscription from the Dodo REST API and rewrites the row. This
 *      is the safety net: webhooks are the primary channel, but a
 *      single missed / unparseable `subscription.cancelled` or
 *      `subscription.expired` event would otherwise strand the mirror
 *      forever (there is no other way the row would ever move). The
 *      reconciliation cron and the on-read resync on /app/billing both
 *      call this so Dodo stays the source of truth even if a webhook
 *      is lost.
 *
 * Responsibilities:
 *   - Upsert one row per Dodo subscription_id into `subscription`.
 *   - Mirror enough state that `hasPro()` in lib/entitlements.ts can
 *     answer gating decisions with a single indexed query, no Dodo
 *     REST round-trip on the hot path.
 *   - Keep access alive for cancelled users until `current_period_end`
 *     (we configured "cancel at period end" in the plan).
 *
 * Webhook payload shape (Standard Webhooks envelope from Dodo):
 *   {
 *     type: "subscription.active" | ...,
 *     data: {
 *       subscription_id: "sub_xxx",
 *       customer: { customer_id, email, metadata: { userId } },
 *       product_id: "pdt_xxx",
 *       status: "active" | "cancelled" | "on_hold" | "expired" | ...,
 *       recurring_pre_tax_amount: 2000,
 *       currency: "USD",
 *       next_billing_date: "2026-05-24T...",
 *       payment_frequency_interval: "Month" | "Year",
 *       cancel_at_next_billing_date?: boolean,
 *       cancelled_at?: string,
 *     }
 *   }
 *
 * We accept the shape loosely — the plugin may hand us the raw event
 * or a slightly re-shaped one, and Dodo has added fields over time.
 * Missing optional fields are tolerated.
 *
 * Resolving the gitshow user: we stamp `metadata.userId` on the Dodo
 * customer at signup (auth.ts `getCustomerParams`) and Dodo echoes it
 * back on webhooks under `data.customer.metadata.userId`. That's the
 * happy path. But operator-initiated cancels from the Dodo *merchant
 * dashboard* — and any customer created before that metadata was
 * wired — can arrive without it. Rather than silently dropping the
 * event (which is exactly how a dashboard cancel could leave the app
 * showing "subscribed" forever), `resolveUserId()` falls back to the
 * customer→user mapping we already hold locally, then to a Dodo
 * customer lookup. We only give up (log + 200, so Dodo stops
 * retrying) when none of those can place the event.
 */

import type { DodoClient } from "@/lib/dodo";

// Intentionally permissive: the Dodo plugin's strict discriminated-union
// `WebhookPayload` type evolves across events and plugin versions. We
// treat the payload as a shape-shaped unknown and narrow at use sites —
// the surface we actually read is stable across event types.
type WebhookPayload = {
  type?: string;
  event_type?: string;
  data?: {
    payload_type?: string;
    subscription_id?: string | null;
    customer?: {
      customer_id?: string | null;
      email?: string | null;
      metadata?: Record<string, string | undefined> | null;
    } | null;
    product_id?: string | null;
    status?: string | null;
    recurring_pre_tax_amount?: number | null;
    currency?: string | null;
    next_billing_date?: string | Date | null;
    payment_frequency_interval?: string | null;
    cancel_at_next_billing_date?: boolean | null;
    cancelled_at?: string | Date | null;
    created_at?: string | Date | null;
  };
};

const SUBSCRIPTION_EVENT_PREFIX = "subscription.";

/**
 * Normalized row we upsert, regardless of whether it came from a
 * webhook envelope or a REST `subscriptions.retrieve()`. Both paths
 * funnel through `upsertSubscriptionRow` so the SQL lives once.
 */
interface NormalizedSubscription {
  subscriptionId: string;
  userId: string;
  customerId: string;
  productId: string;
  status: string;
  interval: string | null;
  amountCents: number | null;
  currency: string | null;
  periodEnd: number;
  cancelAtPeriodEnd: 0 | 1;
  cancelledAt: number | null;
}

// Dodo returns some timestamps as ISO strings, some as serialized Date
// objects (the webhook zod schema `.transform()`s them) depending on
// the path. Normalize to epoch-ms.
function toEpochMs(v: string | Date | null | undefined): number | null {
  if (!v) return null;
  if (v instanceof Date) return v.getTime();
  const n = Date.parse(v);
  return Number.isFinite(n) ? n : null;
}

async function upsertSubscriptionRow(
  db: D1Database,
  n: NormalizedSubscription,
): Promise<void> {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO subscription
         (id, user_id, customer_id, product_id, status, interval,
          amount_cents, currency, current_period_end,
          cancel_at_period_end, cancelled_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         product_id           = excluded.product_id,
         status               = excluded.status,
         interval             = excluded.interval,
         amount_cents         = excluded.amount_cents,
         currency             = excluded.currency,
         current_period_end   = excluded.current_period_end,
         cancel_at_period_end = excluded.cancel_at_period_end,
         cancelled_at         = excluded.cancelled_at,
         updated_at           = excluded.updated_at`,
    )
    .bind(
      n.subscriptionId,
      n.userId,
      n.customerId,
      n.productId,
      n.status,
      n.interval,
      n.amountCents,
      n.currency,
      n.periodEnd,
      n.cancelAtPeriodEnd,
      n.cancelledAt,
      now,
      now,
    )
    .run();
}

/**
 * Resolve the gitshow user_id for an inbound Dodo event, widest-trust
 * source first:
 *
 *   1. `metadata.userId` on the webhook payload (the stamp we set at
 *      signup; present on checkout/portal-driven events).
 *   2. An existing `subscription` row for this subscription_id —
 *      covers the reported bug exactly: the sub was created via
 *      checkout (row written with user_id), then cancelled from the
 *      Dodo dashboard with a payload that dropped the metadata.
 *   3. An existing `subscription` row for this customer_id (a
 *      *different* sub, same customer — e.g. resubscribe).
 *   4. The Dodo customer's own metadata via REST (cold case: first
 *      event for a customer we've never recorded a sub for).
 *
 * Returns null only when none of those can place the event.
 */
async function resolveUserId(
  db: D1Database,
  args: {
    metadataUserId?: string | null;
    subscriptionId: string;
    customerId: string;
  },
  dodo?: DodoClient | null,
): Promise<string | null> {
  if (args.metadataUserId) return args.metadataUserId;

  const bySub = await db
    .prepare(`SELECT user_id FROM subscription WHERE id = ? LIMIT 1`)
    .bind(args.subscriptionId)
    .first<{ user_id: string }>();
  if (bySub?.user_id) return bySub.user_id;

  const byCustomer = await db
    .prepare(
      `SELECT user_id FROM subscription
        WHERE customer_id = ?
        ORDER BY updated_at DESC
        LIMIT 1`,
    )
    .bind(args.customerId)
    .first<{ user_id: string }>();
  if (byCustomer?.user_id) return byCustomer.user_id;

  if (dodo) {
    try {
      const customer = await dodo.customers.retrieve(args.customerId);
      const uid = customer?.metadata?.userId;
      if (typeof uid === "string" && uid) return uid;
    } catch (err) {
      console.warn(
        `[billing-sync] customer lookup failed for ${args.customerId}`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return null;
}

/**
 * Map the SDK `Subscription` (from `subscriptions.retrieve`) onto our
 * normalized row. `status` is taken verbatim — on the PULL path Dodo
 * is authoritative, there's no event type to override it with. The
 * SDK status enum (`pending | active | on_hold | cancelled | failed |
 * expired`) is a superset of what we store; `pending` lands as-is and
 * `isActive()` correctly denies it (it's not in ACTIVE_STATUSES).
 */
function mapDodoSubscription(
  // Loose shape: we only read a stable subset of the SDK type.
  sub: {
    subscription_id: string;
    product_id?: string | null;
    status?: string | null;
    payment_frequency_interval?: string | null;
    recurring_pre_tax_amount?: number | null;
    currency?: string | null;
    next_billing_date?: string | Date | null;
    cancel_at_next_billing_date?: boolean | null;
    cancelled_at?: string | Date | null;
  },
  userId: string,
  customerId: string,
): NormalizedSubscription {
  return {
    subscriptionId: sub.subscription_id,
    userId,
    customerId,
    productId: sub.product_id ?? "",
    status: sub.status ?? "active",
    interval: sub.payment_frequency_interval ?? null,
    amountCents: sub.recurring_pre_tax_amount ?? null,
    currency: sub.currency ?? null,
    periodEnd: toEpochMs(sub.next_billing_date) ?? Date.now(),
    cancelAtPeriodEnd: sub.cancel_at_next_billing_date ? 1 : 0,
    cancelledAt: toEpochMs(sub.cancelled_at),
  };
}

export async function syncSubscriptionFromWebhook(
  db: D1Database,
  rawPayload: unknown,
  dodo?: DodoClient | null,
): Promise<void> {
  const payload = rawPayload as WebhookPayload;
  const eventType = payload.type ?? payload.event_type ?? "";
  if (!eventType.startsWith(SUBSCRIPTION_EVENT_PREFIX)) {
    // Non-subscription events (payment.*, refund.*, dispute.*, credit.*)
    // don't feed the entitlement table. Add handlers here if we ever
    // need dispute or refund side-effects.
    return;
  }

  const data = payload.data;
  if (!data?.subscription_id) return;

  const customerId = data.customer?.customer_id;
  if (!customerId) {
    console.warn(
      `[billing-sync] ${eventType} skipped: missing customer_id`,
      { subscription_id: data.subscription_id },
    );
    return;
  }

  const userId = await resolveUserId(
    db,
    {
      metadataUserId: data.customer?.metadata?.userId,
      subscriptionId: data.subscription_id,
      customerId,
    },
    dodo,
  );
  if (!userId) {
    // Couldn't place this event against a gitshow user by any route.
    // Log but don't throw — returning 200 lets Dodo stop retrying a
    // payload we genuinely can't action.
    console.warn(
      `[billing-sync] ${eventType} skipped: unresolved user`,
      { subscription_id: data.subscription_id, customer_id: customerId },
    );
    return;
  }

  // Status derivation: prefer the server-provided status field, but
  // let the event type override for the transitions we care about so
  // a stray `status: "active"` on a `subscription.cancelled` event
  // can't accidentally re-grant access.
  let status = data.status ?? "active";
  switch (eventType) {
    case "subscription.cancelled":
      status = "cancelled";
      break;
    case "subscription.on_hold":
      status = "on_hold";
      break;
    case "subscription.expired":
      status = "expired";
      break;
    case "subscription.failed":
      status = "failed";
      break;
    case "subscription.renewed":
    case "subscription.active":
    case "subscription.plan_changed":
      status = "active";
      break;
  }

  await upsertSubscriptionRow(db, {
    subscriptionId: data.subscription_id,
    userId,
    customerId,
    productId: data.product_id ?? "",
    status,
    interval: data.payment_frequency_interval ?? null,
    amountCents: data.recurring_pre_tax_amount ?? null,
    currency: data.currency ?? null,
    periodEnd: toEpochMs(data.next_billing_date) ?? Date.now(),
    cancelAtPeriodEnd: data.cancel_at_next_billing_date ? 1 : 0,
    cancelledAt: toEpochMs(data.cancelled_at),
  });
}

export type DodoSyncResult =
  | "updated" // row rewritten from live Dodo state
  | "revoked" // Dodo no longer has the sub → marked expired
  | "skipped"; // no Dodo client / transient error — row left intact

/**
 * PULL path. Fetch the live subscription from Dodo and rewrite the
 * local row. Used by the reconciliation cron and the on-read resync.
 *
 * `userId` / `customerId` come from the local row we're reconciling —
 * we already know who owns it, we're only refreshing *state*.
 *
 * If Dodo 404s the subscription (deleted / never existed), we don't
 * delete the row — we mark it `expired` with `current_period_end` in
 * the past so `isActive()` flips to false immediately while the
 * billing page can still show "Expired" + a re-subscribe CTA.
 *
 * Never throws: every caller is a best-effort safety net. A Dodo
 * outage should degrade to "keep serving the cached row", not error
 * a cron run or a page render.
 */
export async function syncSubscriptionFromDodo(
  db: D1Database,
  dodo: DodoClient | null,
  args: { subscriptionId: string; userId: string; customerId: string },
): Promise<DodoSyncResult> {
  if (!dodo) return "skipped";
  try {
    const sub = await dodo.subscriptions.retrieve(args.subscriptionId);
    await upsertSubscriptionRow(
      db,
      mapDodoSubscription(sub, args.userId, args.customerId),
    );
    return "updated";
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 404) {
      await db
        .prepare(
          `UPDATE subscription
              SET status = 'expired',
                  current_period_end = ?,
                  cancel_at_period_end = 1,
                  updated_at = ?
            WHERE id = ?`,
        )
        .bind(Date.now() - 1, Date.now(), args.subscriptionId)
        .run();
      return "revoked";
    }
    console.warn(
      `[billing-sync] dodo pull failed for ${args.subscriptionId}`,
      err instanceof Error ? err.message : err,
    );
    return "skipped";
  }
}
