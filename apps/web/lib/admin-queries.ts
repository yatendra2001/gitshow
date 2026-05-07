import "server-only";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * D1 queries that power the admin panel at `/app/admin/*`.
 *
 * Scope: a single operator (`yatendra2001`) inspecting every user's
 * profile + scan. No per-user filter — these JOIN across all users.
 * Gate is enforced at the route layer (`requireAdminPage()` /
 * `requireAdminApi()`); these helpers assume the caller already verified.
 */

export interface AdminUserRow {
  user_id: string;
  login: string | null;
  name: string | null;
  email: string | null;
  image: string | null;
  created_at: number | null;
  /** From user_profiles — null if the user never started a scan. */
  handle: string | null;
  public_slug: string | null;
  is_published: 0 | 1;
  view_count: number | null;
  last_scan_at: number | null;
  /** Latest scan summary. */
  latest_scan_id: string | null;
  latest_scan_status: string | null;
  latest_scan_phase: string | null;
  latest_scan_error: string | null;
  latest_scan_created_at: number | null;
  latest_scan_completed_at: number | null;
  /** Count of scans the user has run, for "ran 3 scans" badge. */
  total_scans: number;
  failed_scans: number;
  /** Subscription state for the badge. */
  subscription_status: string | null;
  subscription_period_end: number | null;
}

export interface AdminOverview {
  total_users: number;
  published_users: number;
  draft_only_users: number;
  scanning_users: number;
  failed_only_users: number;
  pro_users: number;
  total_scans: number;
  failed_scans_24h: number;
  failed_scans_7d: number;
  total_views: number;
  recent_signups_24h: number;
}

/**
 * Whole user roster for the admin list page. One row per user, joined
 * with the user_profiles + the latest scan + subscription state. The
 * latest-scan join uses a correlated subquery (`ORDER BY created_at
 * DESC LIMIT 1`) which is fine at this scale (~tens of users) and
 * matches the read pattern the dashboard already uses.
 */
export async function listAdminUsers(
  db: D1Database,
  opts: { limit?: number; search?: string } = {},
): Promise<AdminUserRow[]> {
  const limit = Math.min(opts.limit ?? 200, 500);
  const search = (opts.search ?? "").trim().toLowerCase();
  const where: string[] = [];
  const binds: unknown[] = [];
  if (search) {
    where.push(
      `(LOWER(u.login) LIKE ?1 OR LOWER(u.name) LIKE ?1 OR LOWER(u.email) LIKE ?1 OR LOWER(p.handle) LIKE ?1)`,
    );
    binds.push(`%${search}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const sql = `
    SELECT
      u.id                            AS user_id,
      u.login                         AS login,
      u.name                          AS name,
      u.email                         AS email,
      u.image                         AS image,
      u.createdAt                     AS created_at,
      p.handle                        AS handle,
      p.public_slug                   AS public_slug,
      CASE WHEN p.current_profile_r2_key IS NOT NULL THEN 1 ELSE 0 END AS is_published,
      p.view_count                    AS view_count,
      p.last_scan_at                  AS last_scan_at,
      latest.id                       AS latest_scan_id,
      latest.status                   AS latest_scan_status,
      latest.current_phase            AS latest_scan_phase,
      latest.error                    AS latest_scan_error,
      latest.created_at               AS latest_scan_created_at,
      latest.completed_at             AS latest_scan_completed_at,
      COALESCE(stats.total_scans, 0)  AS total_scans,
      COALESCE(stats.failed_scans, 0) AS failed_scans,
      sub.status                      AS subscription_status,
      sub.current_period_end          AS subscription_period_end
    FROM users u
    LEFT JOIN user_profiles p
      ON p.user_id = u.id
    LEFT JOIN (
      SELECT s1.*
        FROM scans s1
        JOIN (
          SELECT user_id, MAX(created_at) AS max_created
            FROM scans
           GROUP BY user_id
        ) m
          ON s1.user_id = m.user_id AND s1.created_at = m.max_created
    ) latest
      ON latest.user_id = u.id
    LEFT JOIN (
      SELECT user_id,
             COUNT(*) AS total_scans,
             SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_scans
        FROM scans
       GROUP BY user_id
    ) stats
      ON stats.user_id = u.id
    LEFT JOIN (
      SELECT s.user_id, s.status, s.current_period_end
        FROM subscription s
        JOIN (
          SELECT user_id, MAX(current_period_end) AS max_end
            FROM subscription
           GROUP BY user_id
        ) sm
          ON s.user_id = sm.user_id AND s.current_period_end = sm.max_end
    ) sub
      ON sub.user_id = u.id
    ${whereSql}
    ORDER BY COALESCE(latest.created_at, u.createdAt, 0) DESC
    LIMIT ?
  `;
  binds.push(limit);
  const result = await db.prepare(sql).bind(...binds).all<AdminUserRow>();
  return result.results ?? [];
}

export async function getAdminOverview(db: D1Database): Promise<AdminOverview> {
  const dayMs = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const since24h = now - dayMs;
  const since7d = now - 7 * dayMs;

  const [users, scans, views, signups] = await Promise.all([
    db
      .prepare(
        `SELECT
            (SELECT COUNT(*) FROM users)                                           AS total_users,
            (SELECT COUNT(*) FROM user_profiles
              WHERE current_profile_r2_key IS NOT NULL)                            AS published_users,
            (SELECT COUNT(*) FROM user_profiles
              WHERE current_profile_r2_key IS NULL AND current_scan_id IS NOT NULL) AS draft_only_users,
            (SELECT COUNT(DISTINCT user_id) FROM scans
              WHERE status IN ('queued','running'))                                AS scanning_users,
            (SELECT COUNT(*) FROM subscription
              WHERE status IN ('active','cancelled','on_hold')
                AND current_period_end > ?)                                        AS pro_users`,
      )
      .bind(now)
      .first<{
        total_users: number;
        published_users: number;
        draft_only_users: number;
        scanning_users: number;
        pro_users: number;
      }>(),
    db
      .prepare(
        `SELECT
            COUNT(*)                                                       AS total_scans,
            SUM(CASE WHEN status = 'failed' AND created_at > ? THEN 1 ELSE 0 END) AS failed_scans_24h,
            SUM(CASE WHEN status = 'failed' AND created_at > ? THEN 1 ELSE 0 END) AS failed_scans_7d
           FROM scans`,
      )
      .bind(since24h, since7d)
      .first<{
        total_scans: number;
        failed_scans_24h: number;
        failed_scans_7d: number;
      }>(),
    db
      .prepare(`SELECT COALESCE(SUM(view_count), 0) AS total_views FROM user_profiles`)
      .first<{ total_views: number }>(),
    db
      .prepare(`SELECT COUNT(*) AS recent_signups_24h FROM users WHERE createdAt > ?`)
      .bind(since24h)
      .first<{ recent_signups_24h: number }>(),
  ]);

  return {
    total_users: users?.total_users ?? 0,
    published_users: users?.published_users ?? 0,
    draft_only_users: users?.draft_only_users ?? 0,
    scanning_users: users?.scanning_users ?? 0,
    failed_only_users: 0,
    pro_users: users?.pro_users ?? 0,
    total_scans: scans?.total_scans ?? 0,
    failed_scans_24h: scans?.failed_scans_24h ?? 0,
    failed_scans_7d: scans?.failed_scans_7d ?? 0,
    total_views: views?.total_views ?? 0,
    recent_signups_24h: signups?.recent_signups_24h ?? 0,
  };
}

export interface AdminScanRow {
  id: string;
  user_id: string;
  handle: string;
  status: string;
  current_phase: string | null;
  last_completed_phase: string | null;
  error: string | null;
  cost_cents: number;
  llm_calls: number;
  last_heartbeat: number | null;
  fly_machine_id: string | null;
  created_at: number;
  completed_at: number | null;
  access_state: string | null;
  data_sources: string | null;
  user_login: string | null;
  user_email: string | null;
}

export async function listScansByUser(
  db: D1Database,
  userId: string,
  limit = 50,
): Promise<AdminScanRow[]> {
  const result = await db
    .prepare(
      `SELECT s.id, s.user_id, s.handle, s.status, s.current_phase,
              s.last_completed_phase, s.error, s.cost_cents, s.llm_calls,
              s.last_heartbeat, s.fly_machine_id, s.created_at, s.completed_at,
              s.access_state, s.data_sources,
              u.login AS user_login, u.email AS user_email
         FROM scans s
         LEFT JOIN users u ON u.id = s.user_id
        WHERE s.user_id = ?
        ORDER BY s.created_at DESC
        LIMIT ?`,
    )
    .bind(userId, limit)
    .all<AdminScanRow>();
  return result.results ?? [];
}

export async function getAdminScan(
  db: D1Database,
  scanId: string,
): Promise<AdminScanRow | null> {
  const row = await db
    .prepare(
      `SELECT s.id, s.user_id, s.handle, s.status, s.current_phase,
              s.last_completed_phase, s.error, s.cost_cents, s.llm_calls,
              s.last_heartbeat, s.fly_machine_id, s.created_at, s.completed_at,
              s.access_state, s.data_sources,
              u.login AS user_login, u.email AS user_email
         FROM scans s
         LEFT JOIN users u ON u.id = s.user_id
        WHERE s.id = ?
        LIMIT 1`,
    )
    .bind(scanId)
    .first<AdminScanRow>();
  return row ?? null;
}

/**
 * Recent failed/warning events across all scans. Used by the admin
 * landing "Recent issues" feed so the operator can spot regressions
 * without clicking into a specific user.
 */
export interface AdminIssueRow {
  scan_id: string;
  user_id: string;
  user_login: string | null;
  handle: string;
  kind: string;
  stage: string | null;
  worker: string | null;
  status: string | null;
  message: string | null;
  at: number;
  scan_status: string;
}

export async function listRecentIssues(
  db: D1Database,
  limit = 30,
): Promise<AdminIssueRow[]> {
  const result = await db
    .prepare(
      `SELECT e.scan_id, e.kind, e.stage, e.worker, e.status, e.message, e.at,
              s.user_id, s.handle, s.status AS scan_status,
              u.login AS user_login
         FROM scan_events e
         JOIN scans s ON s.id = e.scan_id
         LEFT JOIN users u ON u.id = s.user_id
        WHERE e.kind IN ('error','stage-warn')
        ORDER BY e.at DESC
        LIMIT ?`,
    )
    .bind(limit)
    .all<AdminIssueRow>();
  return result.results ?? [];
}

export interface AdminEventRow {
  id: number;
  scan_id: string;
  kind: string;
  stage: string | null;
  worker: string | null;
  status: string | null;
  duration_ms: number | null;
  message: string | null;
  data_json: string | null;
  parent_id: string | null;
  message_id: string | null;
  at: number;
}

/**
 * Full event log for one scan. Used by the admin scan detail page —
 * we deliberately fetch ALL kinds (not just errors) so the operator
 * can see the whole pipeline trace, including reasoning blocks and
 * tool invocations.
 */
export async function listScanEvents(
  db: D1Database,
  scanId: string,
  limit = 1000,
): Promise<AdminEventRow[]> {
  const result = await db
    .prepare(
      `SELECT id, scan_id, kind, stage, worker, status, duration_ms, message,
              data_json, parent_id, message_id, at
         FROM scan_events
        WHERE scan_id = ?
        ORDER BY at ASC, id ASC
        LIMIT ?`,
    )
    .bind(scanId, limit)
    .all<AdminEventRow>();
  return result.results ?? [];
}

export interface AdminUserDetail {
  user_id: string;
  login: string | null;
  name: string | null;
  email: string | null;
  image: string | null;
  created_at: number | null;
  /** From the OAuth account row — useful to confirm the linked provider. */
  github_account_id: string | null;
  github_scope: string | null;
  /** From user_profiles. */
  handle: string | null;
  public_slug: string | null;
  current_scan_id: string | null;
  current_profile_r2_key: string | null;
  first_scan_at: number | null;
  last_scan_at: number | null;
  view_count: number | null;
  revision_count: number | null;
  /** Subscription. */
  subscription_id: string | null;
  subscription_status: string | null;
  subscription_period_end: number | null;
  subscription_interval: string | null;
  subscription_amount_cents: number | null;
  subscription_currency: string | null;
  cancel_at_period_end: number | null;
  /** Custom domain. */
  custom_hostname: string | null;
  custom_domain_status: string | null;
}

export async function getAdminUserDetail(
  db: D1Database,
  userId: string,
): Promise<AdminUserDetail | null> {
  const row = await db
    .prepare(
      `SELECT
          u.id                       AS user_id,
          u.login                    AS login,
          u.name                     AS name,
          u.email                    AS email,
          u.image                    AS image,
          u.createdAt                AS created_at,
          a.accountId                AS github_account_id,
          a.scope                    AS github_scope,
          p.handle                   AS handle,
          p.public_slug              AS public_slug,
          p.current_scan_id          AS current_scan_id,
          p.current_profile_r2_key   AS current_profile_r2_key,
          p.first_scan_at            AS first_scan_at,
          p.last_scan_at             AS last_scan_at,
          p.view_count               AS view_count,
          p.revision_count           AS revision_count,
          sub.id                     AS subscription_id,
          sub.status                 AS subscription_status,
          sub.current_period_end     AS subscription_period_end,
          sub.interval               AS subscription_interval,
          sub.amount_cents           AS subscription_amount_cents,
          sub.currency               AS subscription_currency,
          sub.cancel_at_period_end   AS cancel_at_period_end,
          d.hostname                 AS custom_hostname,
          d.status                   AS custom_domain_status
        FROM users u
        LEFT JOIN account a
          ON a.userId = u.id AND a.providerId = 'github'
        LEFT JOIN user_profiles p
          ON p.user_id = u.id
        LEFT JOIN (
          SELECT s.*
            FROM subscription s
            JOIN (
              SELECT user_id, MAX(current_period_end) AS max_end
                FROM subscription
               GROUP BY user_id
            ) sm
              ON s.user_id = sm.user_id AND s.current_period_end = sm.max_end
        ) sub
          ON sub.user_id = u.id
        LEFT JOIN custom_domains d
          ON d.user_id = u.id
        WHERE u.id = ?
        LIMIT 1`,
    )
    .bind(userId)
    .first<AdminUserDetail>();
  return row ?? null;
}
