import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDodoClient } from "@/lib/dodo";
import { syncSubscriptionFromDodo } from "@/lib/billing-sync";

/**
 * Subscription reconciliation cron — the webhook safety net.
 *
 * Why this exists: the `subscription` mirror is otherwise updated
 * ONLY by Dodo webhooks. A single missed / unparseable
 * `subscription.cancelled` or `subscription.expired` event (deploy
 * window, brief outage, retry exhaustion, an operator cancel from the
 * Dodo dashboard whose payload we couldn't place) would strand the
 * row forever — the app would keep showing a cancelled user as
 * subscribed with nothing to ever correct it. This pulls live state
 * from the Dodo API and rewrites the row so Dodo stays the source of
 * truth even when a webhook is lost.
 *
 * Scope per run: every row that is still granting access or could
 * still transition (status active/cancelled/on_hold/pending, or
 * period end still in the future) — i.e. NOT the settled
 * expired/failed-and-long-past rows, which Dodo won't change again.
 * Bounded to 100 rows/run, stalest `updated_at` first so a backlog
 * rotates through. Hourly cadence covers 2,400 subs/day — orders of
 * magnitude past what we have.
 *
 * Idempotent: `syncSubscriptionFromDodo` upserts by subscription_id;
 * re-running changes nothing if state already matches.
 *
 * Authorization: `Bearer ${CRON_SECRET}` (shared with the other cron
 * endpoints). Without it, 401. See cron-domains-recheck for the
 * "why GitHub Actions, not Cloudflare triggers.crons" rationale.
 */

export const dynamic = "force-dynamic";

const BATCH = 100;

interface ReconcileRow {
  id: string;
  user_id: string;
  customer_id: string;
}

export async function POST(req: Request) {
  const { env } = await getCloudflareContext({ async: true });
  const auth = req.headers.get("authorization") ?? "";
  if (!env.CRON_SECRET || !auth.startsWith("Bearer ")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const presented = auth.slice(7).trim();
  if (presented !== env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const dodo = getDodoClient(env);
  if (!dodo) {
    // No API key configured (e.g. a preview env). Nothing to pull —
    // report cleanly rather than 500.
    return NextResponse.json({
      checked: 0,
      updated: 0,
      revoked: 0,
      skipped: 0,
      note: "dodo_client_unavailable",
      runAt: Date.now(),
    });
  }

  const now = Date.now();
  const { results } = await env.DB.prepare(
    `SELECT id, user_id, customer_id
       FROM subscription
      WHERE status IN ('active','cancelled','on_hold','pending')
         OR current_period_end > ?
      ORDER BY updated_at ASC
      LIMIT ?`,
  )
    .bind(now, BATCH)
    .all<ReconcileRow>();

  let checked = 0;
  let updated = 0;
  let revoked = 0;
  let skipped = 0;

  for (const row of results ?? []) {
    checked += 1;
    try {
      const result = await syncSubscriptionFromDodo(env.DB, dodo, {
        subscriptionId: row.id,
        userId: row.user_id,
        customerId: row.customer_id,
      });
      if (result === "updated") updated += 1;
      else if (result === "revoked") revoked += 1;
      else skipped += 1;
    } catch {
      // syncSubscriptionFromDodo already swallows + logs; this is a
      // belt-and-braces guard so one bad row can't abort the batch.
      skipped += 1;
    }
  }

  return NextResponse.json({
    checked,
    updated,
    revoked,
    skipped,
    runAt: Date.now(),
  });
}
