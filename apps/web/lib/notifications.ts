/**
 * Notification helpers for the in-app inbox.
 *
 * Triggers: scan-complete / scan-failed / agent-question / revise-applied.
 * Delivery: three channels wired in order — in-app (this module), email
 * (lib/email.ts via Resend), desktop push (lib/push.ts via Web Push).
 *
 * The worker inserts notifications directly via @gitshow/shared/cloud/d1;
 * the web layer only reads + marks read via the helpers below.
 */

export const NOTIFICATION_KINDS = [
  "scan-complete",
  "scan-failed",
  "scan-cancelled",
  "agent-question",
  "revise-applied",
  "intake-ready",
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export interface NotificationRow {
  id: string;
  user_id: string;
  kind: NotificationKind;
  scan_id: string | null;
  title: string;
  body: string | null;
  action_url: string | null;
  payload_json: string | null;
  read_at: number | null;
  email_sent_at: number | null;
  push_sent_at: number | null;
  created_at: number;
}

export interface Notification {
  id: string;
  kind: NotificationKind;
  scan_id: string | null;
  title: string;
  body: string | null;
  action_url: string | null;
  read: boolean;
  created_at: number;
}

export async function listNotificationsForUser(
  db: D1Database,
  userId: string,
  opts: { unreadOnly?: boolean; limit?: number } = {},
): Promise<Notification[]> {
  const limit = Math.min(100, opts.limit ?? 50);
  const where = opts.unreadOnly
    ? "WHERE user_id = ? AND read_at IS NULL"
    : "WHERE user_id = ?";
  const resp = await db
    .prepare(
      `SELECT * FROM notifications ${where} ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(userId, limit)
    .all<NotificationRow>();
  return (resp.results ?? []).map(rowToNotification);
}

export async function countUnreadForUser(
  db: D1Database,
  userId: string,
): Promise<number> {
  const resp = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL`,
    )
    .bind(userId)
    .first<{ n: number }>();
  return resp?.n ?? 0;
}

export async function markNotificationRead(
  db: D1Database,
  notificationId: string,
  userId: string,
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL`,
    )
    .bind(Date.now(), notificationId, userId)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

export async function markAllNotificationsRead(
  db: D1Database,
  userId: string,
): Promise<number> {
  const res = await db
    .prepare(
      `UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL`,
    )
    .bind(Date.now(), userId)
    .run();
  return res.meta?.changes ?? 0;
}

/**
 * Web-side notification creator. Used for cases where the web app itself
 * creates a notification (revise-applied acks, intake-ready). The worker
 * creates scan-complete / scan-failed directly via D1Cloud to avoid an
 * HTTP round-trip.
 */
export async function createNotification(
  db: D1Database,
  params: {
    id: string;
    user_id: string;
    kind: NotificationKind;
    scan_id?: string | null;
    title: string;
    body?: string | null;
    action_url?: string | null;
    payload?: unknown;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO notifications
         (id, user_id, kind, scan_id, title, body, action_url, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      params.id,
      params.user_id,
      params.kind,
      params.scan_id ?? null,
      params.title,
      params.body ?? null,
      params.action_url ?? null,
      params.payload === undefined || params.payload === null
        ? null
        : JSON.stringify(params.payload),
      Date.now(),
    )
    .run();
}

function rowToNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    kind: row.kind,
    scan_id: row.scan_id,
    title: row.title,
    body: row.body,
    action_url: row.action_url,
    read: row.read_at !== null,
    created_at: row.created_at,
  };
}

// ─── Push subscription helpers ────────────────────────────────────

export interface PushSubscriptionRow {
  id: number;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth_token: string;
  user_agent: string | null;
  created_at: number;
  last_used_at: number | null;
  failed_count: number;
}

export async function addPushSubscription(
  db: D1Database,
  params: {
    user_id: string;
    endpoint: string;
    p256dh: string;
    auth_token: string;
    user_agent?: string | null;
  },
): Promise<void> {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO push_subscriptions
         (user_id, endpoint, p256dh, auth_token, user_agent, created_at, last_used_at, failed_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT(user_id, endpoint) DO UPDATE SET
         p256dh = excluded.p256dh,
         auth_token = excluded.auth_token,
         user_agent = excluded.user_agent,
         last_used_at = excluded.last_used_at,
         failed_count = 0`,
    )
    .bind(
      params.user_id,
      params.endpoint,
      params.p256dh,
      params.auth_token,
      params.user_agent ?? null,
      now,
      now,
    )
    .run();
}

export async function listPushSubscriptionsForUser(
  db: D1Database,
  userId: string,
): Promise<PushSubscriptionRow[]> {
  const resp = await db
    .prepare(`SELECT * FROM push_subscriptions WHERE user_id = ?`)
    .bind(userId)
    .all<PushSubscriptionRow>();
  return resp.results ?? [];
}

export async function removePushSubscription(
  db: D1Database,
  userId: string,
  endpoint: string,
): Promise<void> {
  await db
    .prepare(
      `DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?`,
    )
    .bind(userId, endpoint)
    .run();
}
