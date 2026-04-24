/**
 * Dodo Payments webhook → D1 `subscription` table sync.
 *
 * Called from the `onPayload` callback inside the Better Auth Dodo
 * plugin (auth.ts). The plugin verifies the webhook signature before
 * we run — by the time a payload gets here it's authenticated.
 *
 * Responsibilities:
 *   - Upsert one row per Dodo subscription_id into `subscription`.
 *   - Mirror enough state that `hasPro()` in lib/entitlements.ts can
 *     answer gating decisions with a single indexed query, no Dodo
 *     REST round-trip.
 *   - Keep access alive for cancelled users until `current_period_end`
 *     (we configured "cancel at period end" in the plan).
 *
 * Payload shape (Standard Webhooks envelope from Dodo):
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
 * Missing optional fields are tolerated; missing required ones
 * (subscription_id, customer metadata.userId) bail out quietly so a
 * malformed webhook never 500s the endpoint and Dodo retries
 * needlessly.
 */

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

// Dodo returns some timestamps as ISO strings, some as serialized Date
// objects depending on the event version. Normalize to epoch-ms.
function toEpochMs(v: string | Date | null | undefined): number | null {
  if (!v) return null;
  if (v instanceof Date) return v.getTime();
  const n = Date.parse(v);
  return Number.isFinite(n) ? n : null;
}

export async function syncSubscriptionFromWebhook(
  db: D1Database,
  rawPayload: unknown,
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

  const userId = data.customer?.metadata?.userId;
  const customerId = data.customer?.customer_id;
  if (!userId || !customerId) {
    // Missing the mapping we rely on. Log but don't throw — returning
    // 200 lets Dodo stop retrying a payload we can't action.
    console.warn(
      `[billing-sync] ${eventType} skipped: missing userId/customer_id`,
      { subscription_id: data.subscription_id },
    );
    return;
  }

  const productId = data.product_id ?? "";
  const interval = data.payment_frequency_interval ?? null;
  const amountCents = data.recurring_pre_tax_amount ?? null;
  const currency = data.currency ?? null;
  const periodEnd = toEpochMs(data.next_billing_date) ?? Date.now();
  const cancelledAt = toEpochMs(data.cancelled_at);
  const cancelAtPeriodEnd = data.cancel_at_next_billing_date ? 1 : 0;
  const now = Date.now();

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
      data.subscription_id,
      userId,
      customerId,
      productId,
      status,
      interval,
      amountCents,
      currency,
      periodEnd,
      cancelAtPeriodEnd,
      cancelledAt,
      now,
      now,
    )
    .run();
}
