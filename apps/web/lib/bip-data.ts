/**
 * D1 helpers for the dev-brand-system surfaces:
 *   - voice samples + profile
 *   - audience config
 *   - bip events + drafts
 *   - open-to-work settings
 *   - recruiter inbound
 *
 * Every helper is a thin SQL wrapper. No business logic — that lives in
 * the route handlers and `lib/bip-ai.ts`. This file just keeps the SQL
 * out of the route files so the routes stay readable.
 */

import "server-only";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import type { VoiceProfile, DraftBlob, DraftPlatform } from "./bip-ai";

// ──────────────────────────────────────────────────────────────
// Voice samples + profile
// ──────────────────────────────────────────────────────────────

export interface VoiceSampleRow {
  id: number;
  user_id: string;
  kind: "tweet" | "linkedin" | "blog" | "slack" | "other";
  source_url: string | null;
  body: string;
  created_at: number;
}

export async function listVoiceSamples(
  db: D1Database,
  userId: string,
): Promise<VoiceSampleRow[]> {
  const res = await db
    .prepare(
      `SELECT id, user_id, kind, source_url, body, created_at
         FROM bip_voice_samples
        WHERE user_id = ?
        ORDER BY created_at DESC`,
    )
    .bind(userId)
    .all<VoiceSampleRow>();
  return res.results ?? [];
}

/** Replace all samples for a user atomically (delete + insert). */
export async function replaceVoiceSamples(
  db: D1Database,
  userId: string,
  samples: Array<{
    kind: VoiceSampleRow["kind"];
    body: string;
    source_url?: string | null;
  }>,
): Promise<void> {
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [
    db.prepare(`DELETE FROM bip_voice_samples WHERE user_id = ?`).bind(userId),
  ];
  for (const s of samples) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO bip_voice_samples
             (user_id, kind, source_url, body, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(userId, s.kind, s.source_url ?? null, s.body, now),
    );
  }
  await db.batch(stmts);
}

export interface VoiceProfileRow {
  user_id: string;
  profile_json: string;
  sample_count: number;
  generated_at: number;
  updated_at: number;
}

export async function loadVoiceProfile(
  db: D1Database,
  userId: string,
): Promise<{ profile: VoiceProfile; sample_count: number; generated_at: number } | null> {
  const row = await db
    .prepare(
      `SELECT user_id, profile_json, sample_count, generated_at, updated_at
         FROM bip_voice_profiles WHERE user_id = ? LIMIT 1`,
    )
    .bind(userId)
    .first<VoiceProfileRow>();
  if (!row) return null;
  try {
    const profile = JSON.parse(row.profile_json) as VoiceProfile;
    return {
      profile,
      sample_count: row.sample_count,
      generated_at: row.generated_at,
    };
  } catch {
    return null;
  }
}

export async function upsertVoiceProfile(
  db: D1Database,
  userId: string,
  profile: VoiceProfile,
  sampleCount: number,
): Promise<void> {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO bip_voice_profiles
         (user_id, profile_json, sample_count, generated_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         profile_json = excluded.profile_json,
         sample_count = excluded.sample_count,
         generated_at = excluded.generated_at,
         updated_at   = excluded.updated_at`,
    )
    .bind(userId, JSON.stringify(profile), sampleCount, now, now)
    .run();
}

// ──────────────────────────────────────────────────────────────
// Audience config
// ──────────────────────────────────────────────────────────────

export interface AudienceConfig {
  platforms: DraftPlatform[];
  min_significance: number;
  notify_email: boolean;
  weekly_digest: boolean;
}

const DEFAULT_AUDIENCE: AudienceConfig = {
  platforms: ["x_thread", "linkedin", "blog"],
  min_significance: 6,
  notify_email: true,
  weekly_digest: true,
};

export async function loadAudienceConfig(
  db: D1Database,
  userId: string,
): Promise<AudienceConfig> {
  const row = await db
    .prepare(
      `SELECT platforms_json, min_significance, notify_email, weekly_digest
         FROM bip_audience_config WHERE user_id = ? LIMIT 1`,
    )
    .bind(userId)
    .first<{
      platforms_json: string;
      min_significance: number;
      notify_email: number;
      weekly_digest: number;
    }>();
  if (!row) return DEFAULT_AUDIENCE;
  let platforms: DraftPlatform[] = DEFAULT_AUDIENCE.platforms;
  try {
    const parsed = JSON.parse(row.platforms_json) as unknown;
    if (Array.isArray(parsed)) {
      platforms = parsed.filter((p): p is DraftPlatform =>
        p === "x_thread" || p === "linkedin" || p === "blog",
      );
    }
  } catch {
    /* keep default */
  }
  return {
    platforms,
    min_significance: row.min_significance,
    notify_email: row.notify_email === 1,
    weekly_digest: row.weekly_digest === 1,
  };
}

export async function upsertAudienceConfig(
  db: D1Database,
  userId: string,
  cfg: Partial<AudienceConfig>,
): Promise<AudienceConfig> {
  const current = await loadAudienceConfig(db, userId);
  const merged: AudienceConfig = {
    platforms: cfg.platforms ?? current.platforms,
    min_significance: cfg.min_significance ?? current.min_significance,
    notify_email: cfg.notify_email ?? current.notify_email,
    weekly_digest: cfg.weekly_digest ?? current.weekly_digest,
  };
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO bip_audience_config
         (user_id, platforms_json, min_significance, notify_email, weekly_digest, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         platforms_json   = excluded.platforms_json,
         min_significance = excluded.min_significance,
         notify_email     = excluded.notify_email,
         weekly_digest    = excluded.weekly_digest,
         updated_at       = excluded.updated_at`,
    )
    .bind(
      userId,
      JSON.stringify(merged.platforms),
      merged.min_significance,
      merged.notify_email ? 1 : 0,
      merged.weekly_digest ? 1 : 0,
      now,
      now,
    )
    .run();
  return merged;
}

// ──────────────────────────────────────────────────────────────
// bip events + drafts
// ──────────────────────────────────────────────────────────────

export interface BipEventRow {
  id: number;
  user_id: string;
  source:
    | "manual"
    | "kg_project"
    | "gh_release"
    | "gh_pr_merged"
    | "star_milestone";
  title: string;
  summary: string | null;
  url: string | null;
  repo_full_name: string | null;
  metadata_json: string | null;
  significance: number;
  occurred_at: number;
  created_at: number;
}

export interface BipDraftRow {
  id: number;
  user_id: string;
  event_id: number;
  content_json: string;
  status: "draft" | "dismissed" | "posted";
  marked_posted_platforms: string | null;
  model: string;
  created_at: number;
  updated_at: number;
}

export interface DraftWithEvent {
  draft: BipDraftRow;
  event: BipEventRow;
  content: DraftBlob;
}

export async function listDraftsWithEvents(
  db: D1Database,
  userId: string,
  limit = 50,
): Promise<DraftWithEvent[]> {
  const res = await db
    .prepare(
      `SELECT d.id AS d_id, d.event_id, d.content_json, d.status,
              d.marked_posted_platforms, d.model, d.created_at AS d_created_at,
              d.updated_at,
              e.id AS e_id, e.source, e.title, e.summary, e.url,
              e.repo_full_name, e.metadata_json, e.significance,
              e.occurred_at, e.created_at AS e_created_at
         FROM bip_drafts d
         JOIN bip_events e ON e.id = d.event_id
        WHERE d.user_id = ?
        ORDER BY d.updated_at DESC
        LIMIT ?`,
    )
    .bind(userId, limit)
    .all<{
      d_id: number;
      event_id: number;
      content_json: string;
      status: BipDraftRow["status"];
      marked_posted_platforms: string | null;
      model: string;
      d_created_at: number;
      updated_at: number;
      e_id: number;
      source: BipEventRow["source"];
      title: string;
      summary: string | null;
      url: string | null;
      repo_full_name: string | null;
      metadata_json: string | null;
      significance: number;
      occurred_at: number;
      e_created_at: number;
    }>();
  const rows = res.results ?? [];
  return rows.map((r) => {
    let content: DraftBlob = {};
    try {
      content = JSON.parse(r.content_json) as DraftBlob;
    } catch {
      content = {};
    }
    return {
      draft: {
        id: r.d_id,
        user_id: userId,
        event_id: r.event_id,
        content_json: r.content_json,
        status: r.status,
        marked_posted_platforms: r.marked_posted_platforms,
        model: r.model,
        created_at: r.d_created_at,
        updated_at: r.updated_at,
      },
      event: {
        id: r.e_id,
        user_id: userId,
        source: r.source,
        title: r.title,
        summary: r.summary,
        url: r.url,
        repo_full_name: r.repo_full_name,
        metadata_json: r.metadata_json,
        significance: r.significance,
        occurred_at: r.occurred_at,
        created_at: r.e_created_at,
      },
      content,
    };
  });
}

export async function loadDraftWithEvent(
  db: D1Database,
  userId: string,
  draftId: number,
): Promise<DraftWithEvent | null> {
  const all = await db
    .prepare(
      `SELECT d.id AS d_id, d.event_id, d.content_json, d.status,
              d.marked_posted_platforms, d.model, d.created_at AS d_created_at,
              d.updated_at,
              e.id AS e_id, e.source, e.title, e.summary, e.url,
              e.repo_full_name, e.metadata_json, e.significance,
              e.occurred_at, e.created_at AS e_created_at
         FROM bip_drafts d
         JOIN bip_events e ON e.id = d.event_id
        WHERE d.user_id = ? AND d.id = ?
        LIMIT 1`,
    )
    .bind(userId, draftId)
    .first<{
      d_id: number;
      event_id: number;
      content_json: string;
      status: BipDraftRow["status"];
      marked_posted_platforms: string | null;
      model: string;
      d_created_at: number;
      updated_at: number;
      e_id: number;
      source: BipEventRow["source"];
      title: string;
      summary: string | null;
      url: string | null;
      repo_full_name: string | null;
      metadata_json: string | null;
      significance: number;
      occurred_at: number;
      e_created_at: number;
    }>();
  if (!all) return null;
  let content: DraftBlob = {};
  try {
    content = JSON.parse(all.content_json) as DraftBlob;
  } catch {
    content = {};
  }
  return {
    draft: {
      id: all.d_id,
      user_id: userId,
      event_id: all.event_id,
      content_json: all.content_json,
      status: all.status,
      marked_posted_platforms: all.marked_posted_platforms,
      model: all.model,
      created_at: all.d_created_at,
      updated_at: all.updated_at,
    },
    event: {
      id: all.e_id,
      user_id: userId,
      source: all.source,
      title: all.title,
      summary: all.summary,
      url: all.url,
      repo_full_name: all.repo_full_name,
      metadata_json: all.metadata_json,
      significance: all.significance,
      occurred_at: all.occurred_at,
      created_at: all.e_created_at,
    },
    content,
  };
}

export async function createEventAndDraft(
  db: D1Database,
  userId: string,
  args: {
    source: BipEventRow["source"];
    title: string;
    summary: string | null;
    url: string | null;
    repoFullName: string | null;
    metadata: Record<string, unknown> | null;
    significance: number;
    occurredAt: number;
    draftContent: DraftBlob;
    model: string;
  },
): Promise<{ eventId: number; draftId: number }> {
  const now = Date.now();
  const ev = await db
    .prepare(
      `INSERT INTO bip_events
         (user_id, source, title, summary, url, repo_full_name,
          metadata_json, significance, occurred_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
    )
    .bind(
      userId,
      args.source,
      args.title,
      args.summary,
      args.url,
      args.repoFullName,
      args.metadata ? JSON.stringify(args.metadata) : null,
      args.significance,
      args.occurredAt,
      now,
    )
    .first<{ id: number }>();
  if (!ev) throw new Error("create_event_failed");

  const dr = await db
    .prepare(
      `INSERT INTO bip_drafts
         (user_id, event_id, content_json, status, model, created_at, updated_at)
       VALUES (?, ?, ?, 'draft', ?, ?, ?)
       RETURNING id`,
    )
    .bind(
      userId,
      ev.id,
      JSON.stringify(args.draftContent),
      args.model,
      now,
      now,
    )
    .first<{ id: number }>();
  if (!dr) throw new Error("create_draft_failed");

  return { eventId: ev.id, draftId: dr.id };
}

export async function updateDraftContent(
  db: D1Database,
  userId: string,
  draftId: number,
  content: DraftBlob,
): Promise<void> {
  await db
    .prepare(
      `UPDATE bip_drafts
          SET content_json = ?, updated_at = ?
        WHERE id = ? AND user_id = ?`,
    )
    .bind(JSON.stringify(content), Date.now(), draftId, userId)
    .run();
}

export async function updateDraftStatus(
  db: D1Database,
  userId: string,
  draftId: number,
  status: BipDraftRow["status"],
  markedPlatforms?: string | null,
): Promise<void> {
  await db
    .prepare(
      `UPDATE bip_drafts
          SET status = ?, marked_posted_platforms = ?, updated_at = ?
        WHERE id = ? AND user_id = ?`,
    )
    .bind(status, markedPlatforms ?? null, Date.now(), draftId, userId)
    .run();
}

// ──────────────────────────────────────────────────────────────
// Open-to-work settings
// ──────────────────────────────────────────────────────────────

export interface OpenToWorkSettings {
  status: "looking" | "selectively" | "not_looking";
  roles: string | null;
  locations: string | null;
  comp_min_usd: number | null;
  comp_max_usd: number | null;
  blurb: string | null;
  contact_email: string | null;
  show_comp: boolean;
}

const DEFAULT_OPEN_TO_WORK: OpenToWorkSettings = {
  status: "looking",
  roles: null,
  locations: null,
  comp_min_usd: null,
  comp_max_usd: null,
  blurb: null,
  contact_email: null,
  show_comp: false,
};

export async function loadOpenToWorkSettings(
  db: D1Database,
  userId: string,
): Promise<OpenToWorkSettings> {
  const row = await db
    .prepare(
      `SELECT status, roles, locations, comp_min_usd, comp_max_usd,
              blurb, contact_email, show_comp
         FROM open_to_work_settings WHERE user_id = ? LIMIT 1`,
    )
    .bind(userId)
    .first<{
      status: OpenToWorkSettings["status"];
      roles: string | null;
      locations: string | null;
      comp_min_usd: number | null;
      comp_max_usd: number | null;
      blurb: string | null;
      contact_email: string | null;
      show_comp: number;
    }>();
  if (!row) return DEFAULT_OPEN_TO_WORK;
  return {
    status: row.status,
    roles: row.roles,
    locations: row.locations,
    comp_min_usd: row.comp_min_usd,
    comp_max_usd: row.comp_max_usd,
    blurb: row.blurb,
    contact_email: row.contact_email,
    show_comp: row.show_comp === 1,
  };
}

export async function upsertOpenToWorkSettings(
  db: D1Database,
  userId: string,
  patch: Partial<OpenToWorkSettings>,
): Promise<OpenToWorkSettings> {
  const current = await loadOpenToWorkSettings(db, userId);
  const merged: OpenToWorkSettings = { ...current, ...patch };
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO open_to_work_settings
         (user_id, status, roles, locations, comp_min_usd, comp_max_usd,
          blurb, contact_email, show_comp, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         status        = excluded.status,
         roles         = excluded.roles,
         locations     = excluded.locations,
         comp_min_usd  = excluded.comp_min_usd,
         comp_max_usd  = excluded.comp_max_usd,
         blurb         = excluded.blurb,
         contact_email = excluded.contact_email,
         show_comp     = excluded.show_comp,
         updated_at    = excluded.updated_at`,
    )
    .bind(
      userId,
      merged.status,
      merged.roles,
      merged.locations,
      merged.comp_min_usd,
      merged.comp_max_usd,
      merged.blurb,
      merged.contact_email,
      merged.show_comp ? 1 : 0,
      now,
      now,
    )
    .run();
  return merged;
}

export async function setDiscoverable(
  db: D1Database,
  userId: string,
  on: boolean,
): Promise<void> {
  await db
    .prepare(`UPDATE users SET discoverable = ? WHERE id = ?`)
    .bind(on ? 1 : 0, userId)
    .run();
}

export async function getDiscoverable(
  db: D1Database,
  userId: string,
): Promise<boolean> {
  const row = await db
    .prepare(`SELECT discoverable FROM users WHERE id = ? LIMIT 1`)
    .bind(userId)
    .first<{ discoverable: number }>();
  return row?.discoverable === 1;
}

// ──────────────────────────────────────────────────────────────
// Recruiter inbound
// ──────────────────────────────────────────────────────────────

export interface RecruiterInboundRow {
  id: number;
  user_id: string;
  from_name: string;
  from_email: string;
  from_company: string | null;
  from_role: string | null;
  role_title: string | null;
  role_link: string | null;
  comp_note: string | null;
  location_note: string | null;
  body: string;
  spam_score: number;
  fit_score: number;
  fit_reason: string | null;
  status: "new" | "read" | "replied" | "archived" | "spam";
  source_hostname: string | null;
  source_ip: string | null;
  source_ua: string | null;
  read_at: number | null;
  replied_at: number | null;
  created_at: number;
}

export async function listRecruiterInbound(
  db: D1Database,
  userId: string,
  limit = 50,
): Promise<RecruiterInboundRow[]> {
  const res = await db
    .prepare(
      `SELECT id, user_id, from_name, from_email, from_company, from_role,
              role_title, role_link, comp_note, location_note, body,
              spam_score, fit_score, fit_reason, status,
              source_hostname, source_ip, source_ua, read_at, replied_at,
              created_at
         FROM recruiter_inbound
        WHERE user_id = ? AND status != 'spam'
        ORDER BY
          CASE status WHEN 'new' THEN 0 WHEN 'read' THEN 1 ELSE 2 END,
          fit_score DESC, created_at DESC
        LIMIT ?`,
    )
    .bind(userId, limit)
    .all<RecruiterInboundRow>();
  return res.results ?? [];
}

export async function insertRecruiterInbound(
  db: D1Database,
  userId: string,
  row: Omit<RecruiterInboundRow, "id" | "user_id" | "read_at" | "replied_at" | "status"> & {
    status?: RecruiterInboundRow["status"];
  },
): Promise<number> {
  const res = await db
    .prepare(
      `INSERT INTO recruiter_inbound
         (user_id, from_name, from_email, from_company, from_role,
          role_title, role_link, comp_note, location_note, body,
          spam_score, fit_score, fit_reason, status,
          source_hostname, source_ip, source_ua, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
    )
    .bind(
      userId,
      row.from_name,
      row.from_email,
      row.from_company,
      row.from_role,
      row.role_title,
      row.role_link,
      row.comp_note,
      row.location_note,
      row.body,
      row.spam_score,
      row.fit_score,
      row.fit_reason,
      row.status ?? "new",
      row.source_hostname,
      row.source_ip,
      row.source_ua,
      row.created_at,
    )
    .first<{ id: number }>();
  if (!res) throw new Error("insert_recruiter_failed");
  return res.id;
}

export async function markInboundStatus(
  db: D1Database,
  userId: string,
  id: number,
  status: RecruiterInboundRow["status"],
): Promise<void> {
  const now = Date.now();
  const stamp =
    status === "read"
      ? "read_at = ?"
      : status === "replied"
        ? "replied_at = ?"
        : null;
  if (stamp) {
    await db
      .prepare(
        `UPDATE recruiter_inbound
            SET status = ?, ${stamp}
          WHERE id = ? AND user_id = ?`,
      )
      .bind(status, now, id, userId)
      .run();
  } else {
    await db
      .prepare(
        `UPDATE recruiter_inbound SET status = ? WHERE id = ? AND user_id = ?`,
      )
      .bind(status, id, userId)
      .run();
  }
}

// ──────────────────────────────────────────────────────────────
// Contact rate-limit (per user × IP, sliding 1h window)
// ──────────────────────────────────────────────────────────────

const CONTACT_WINDOW_MS = 60 * 60 * 1000;
const CONTACT_MAX_PER_WINDOW = 5;

/**
 * Returns true if the request should be allowed. Increments the bucket
 * counter on allow. Caller is responsible for returning 429 on deny.
 */
export async function tryConsumeContactBucket(
  db: D1Database,
  userId: string,
  ip: string,
): Promise<boolean> {
  const key = `contact:user:${userId}:ip:${ip}`;
  const now = Date.now();
  const row = await db
    .prepare(`SELECT count, window_start FROM contact_rate_limits WHERE bucket_key = ?`)
    .bind(key)
    .first<{ count: number; window_start: number }>();
  if (!row || now - row.window_start > CONTACT_WINDOW_MS) {
    await db
      .prepare(
        `INSERT INTO contact_rate_limits (bucket_key, count, window_start)
         VALUES (?, 1, ?)
         ON CONFLICT(bucket_key) DO UPDATE SET count = 1, window_start = ?`,
      )
      .bind(key, now, now)
      .run();
    return true;
  }
  if (row.count >= CONTACT_MAX_PER_WINDOW) return false;
  await db
    .prepare(
      `UPDATE contact_rate_limits SET count = count + 1 WHERE bucket_key = ?`,
    )
    .bind(key)
    .run();
  return true;
}

// ──────────────────────────────────────────────────────────────
// Public lookup — used by the portfolio "open to" badge
// ──────────────────────────────────────────────────────────────

export interface PublicHiringPayload {
  userId: string;
  handle: string;
  publicSlug: string;
  discoverable: boolean;
  settings: OpenToWorkSettings;
}

/**
 * Public lookup keyed by portfolio slug. Returns null when the user
 * doesn't exist, is not discoverable, or has explicitly set status to
 * "not_looking" — the portfolio render path treats all three the same.
 */
export async function loadPublicHiringByHandle(
  db: D1Database,
  handle: string,
): Promise<PublicHiringPayload | null> {
  const row = await db
    .prepare(
      `SELECT u.id AS user_id, up.handle, up.public_slug, u.discoverable,
              s.status, s.roles, s.locations, s.comp_min_usd, s.comp_max_usd,
              s.blurb, s.contact_email, s.show_comp
         FROM user_profiles up
         JOIN users u ON u.id = up.user_id
         LEFT JOIN open_to_work_settings s ON s.user_id = up.user_id
        WHERE LOWER(up.public_slug) = LOWER(?)
           OR LOWER(up.handle) = LOWER(?)
        LIMIT 1`,
    )
    .bind(handle, handle)
    .first<{
      user_id: string;
      handle: string;
      public_slug: string;
      discoverable: number;
      status: OpenToWorkSettings["status"] | null;
      roles: string | null;
      locations: string | null;
      comp_min_usd: number | null;
      comp_max_usd: number | null;
      blurb: string | null;
      contact_email: string | null;
      show_comp: number | null;
    }>();
  if (!row) return null;
  const discoverable = row.discoverable === 1;
  const status = row.status ?? "looking";
  if (!discoverable || status === "not_looking") return null;
  const settings: OpenToWorkSettings = {
    status,
    roles: row.roles,
    locations: row.locations,
    comp_min_usd: row.comp_min_usd,
    comp_max_usd: row.comp_max_usd,
    blurb: row.blurb,
    contact_email: row.contact_email,
    show_comp: row.show_comp === 1,
  };
  return {
    userId: row.user_id,
    handle: row.handle,
    publicSlug: row.public_slug,
    discoverable,
    settings,
  };
}
