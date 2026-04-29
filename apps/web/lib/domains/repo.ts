/**
 * Persistence layer for `custom_domains`. All mutation paths go
 * through here so the state machine is enforced in one place.
 *
 * State machine:
 *
 *   pending     → verifying     (user clicked "Verify now" first time)
 *   verifying   → provisioning  (DNS+TXT seen, CF cert in progress)
 *   verifying   → failed        (terminal — see failure_reason)
 *   provisioning→ active        (CF reports ssl active)
 *   provisioning→ failed
 *   active      → suspended     (cron observed CNAME break)
 *   suspended   → active        (cron observed CNAME re-fixed)
 *   any         → deleted       (user disconnected)
 *
 * Every transition writes a domain_events row via security.recordAudit
 * for support / abuse forensics.
 */

import type { D1Database } from "@cloudflare/workers-types";
import { recordAudit, type DomainEventType } from "./security";

export type DomainStatus =
  | "pending"
  | "verifying"
  | "provisioning"
  | "active"
  | "suspended"
  | "failed";

export type ApexStrategyDb =
  | "cname_flatten"
  | "alias"
  | "www_redirect"
  | null;

export interface CustomDomainRow {
  id: string;
  user_id: string;
  hostname: string;
  is_apex: number; // 0 | 1
  apex_strategy: ApexStrategyDb;
  status: DomainStatus;
  setup_method: "manual" | "gemini_assisted" | null;
  detected_provider: string | null;
  verification_token: string;
  cf_custom_hostname_id: string | null;
  cf_ssl_status: string | null;
  cf_ssl_method: string | null;
  failure_reason: string | null;
  last_check_at: number | null;
  last_active_check_at: number | null;
  created_at: number;
  activated_at: number | null;
  updated_at: number;
}

export async function getDomainByUser(
  db: D1Database,
  userId: string,
): Promise<CustomDomainRow | null> {
  return db
    .prepare(`SELECT * FROM custom_domains WHERE user_id = ? LIMIT 1`)
    .bind(userId)
    .first<CustomDomainRow>();
}

export async function getDomainByHostname(
  db: D1Database,
  hostname: string,
): Promise<CustomDomainRow | null> {
  return db
    .prepare(`SELECT * FROM custom_domains WHERE hostname = ? LIMIT 1`)
    .bind(hostname.toLowerCase())
    .first<CustomDomainRow>();
}

export async function getDomainById(
  db: D1Database,
  id: string,
): Promise<CustomDomainRow | null> {
  return db
    .prepare(`SELECT * FROM custom_domains WHERE id = ? LIMIT 1`)
    .bind(id)
    .first<CustomDomainRow>();
}

export interface CreateDomainInput {
  id: string;
  userId: string;
  hostname: string;
  isApex: boolean;
  apexStrategy: ApexStrategyDb;
  detectedProvider: string | null;
  verificationToken: string;
  setupMethod: "manual" | "gemini_assisted";
  ip: string | null;
  userAgent: string | null;
}

/**
 * Insert a new pending domain. Returns false if the hostname is
 * already taken (UNIQUE constraint). Throws on other errors.
 */
export async function createDomain(
  db: D1Database,
  input: CreateDomainInput,
): Promise<boolean> {
  const now = Date.now();
  try {
    await db
      .prepare(
        `INSERT INTO custom_domains
           (id, user_id, hostname, is_apex, apex_strategy, status,
            setup_method, detected_provider, verification_token,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.id,
        input.userId,
        input.hostname,
        input.isApex ? 1 : 0,
        input.apexStrategy,
        input.setupMethod,
        input.detectedProvider,
        input.verificationToken,
        now,
        now,
      )
      .run();
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (msg.includes("UNIQUE") || msg.includes("constraint")) return false;
    throw err;
  }

  await recordAudit(db, {
    customDomainId: input.id,
    userId: input.userId,
    eventType: "created",
    newStatus: "pending",
    actor: "user",
    ip: input.ip,
    userAgent: input.userAgent,
    metadata: {
      hostname: input.hostname,
      isApex: input.isApex,
      apexStrategy: input.apexStrategy,
      detectedProvider: input.detectedProvider,
      setupMethod: input.setupMethod,
    },
  });
  return true;
}

export interface TransitionInput {
  id: string;
  userId: string;
  next: DomainStatus;
  prev?: DomainStatus | null;
  cfId?: string | null;
  cfSslStatus?: string | null;
  cfSslMethod?: string | null;
  failureReason?: string | null;
  actor?: "user" | "system" | "admin";
  eventType?: DomainEventType;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

export async function transitionStatus(
  db: D1Database,
  input: TransitionInput,
): Promise<void> {
  const now = Date.now();
  const isActivating = input.next === "active";
  await db
    .prepare(
      `UPDATE custom_domains
          SET status = ?,
              cf_custom_hostname_id = COALESCE(?, cf_custom_hostname_id),
              cf_ssl_status = COALESCE(?, cf_ssl_status),
              cf_ssl_method = COALESCE(?, cf_ssl_method),
              failure_reason = ?,
              last_check_at = ?,
              last_active_check_at = CASE WHEN ? = 'active' THEN ? ELSE last_active_check_at END,
              activated_at = COALESCE(activated_at, CASE WHEN ? = 1 THEN ? ELSE NULL END),
              updated_at = ?
        WHERE id = ?`,
    )
    .bind(
      input.next,
      input.cfId ?? null,
      input.cfSslStatus ?? null,
      input.cfSslMethod ?? null,
      input.failureReason ?? null,
      now,
      input.next,
      now,
      isActivating ? 1 : 0,
      now,
      now,
      input.id,
    )
    .run();

  await recordAudit(db, {
    customDomainId: input.id,
    userId: input.userId,
    eventType: input.eventType ?? mapTransitionToEvent(input.next),
    prevStatus: input.prev ?? null,
    newStatus: input.next,
    actor: input.actor ?? "system",
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
    metadata: input.metadata,
  });
}

function mapTransitionToEvent(s: DomainStatus): DomainEventType {
  switch (s) {
    case "pending":
      return "created";
    case "verifying":
      return "verify_attempt";
    case "provisioning":
      return "dns_verified";
    case "active":
      return "activated";
    case "suspended":
      return "suspended";
    case "failed":
      return "failed";
  }
}

export async function deleteDomain(
  db: D1Database,
  id: string,
  userId: string,
  meta: { ip?: string | null; userAgent?: string | null; actor?: "user" | "admin" },
): Promise<void> {
  await db.prepare(`DELETE FROM custom_domains WHERE id = ?`).bind(id).run();
  await recordAudit(db, {
    customDomainId: id,
    userId,
    eventType: "deleted",
    actor: meta.actor ?? "user",
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
}

/**
 * Lookup table for the routing middleware. Returns the user's slug
 * (or handle) for a given active hostname. Read-heavy; we cache via
 * Workers Cache in middleware.ts so this doesn't run per-request.
 *
 * Joins user_profiles to grab the `public_slug` we render at /{handle}.
 */
export interface RoutingLookup {
  hostname: string;
  user_id: string;
  public_slug: string;
  is_published: number;
}

export async function lookupRoutingByHostname(
  db: D1Database,
  hostname: string,
): Promise<RoutingLookup | null> {
  return db
    .prepare(
      `SELECT cd.hostname AS hostname, cd.user_id AS user_id,
              up.public_slug AS public_slug,
              CASE WHEN up.current_profile_r2_key IS NOT NULL THEN 1 ELSE 0 END AS is_published
         FROM custom_domains cd
         LEFT JOIN user_profiles up ON up.user_id = cd.user_id
        WHERE cd.hostname = ? AND cd.status = 'active'
        LIMIT 1`,
    )
    .bind(hostname.toLowerCase())
    .first<RoutingLookup>();
}

export async function listActiveForRecheck(
  db: D1Database,
  staleAfterMs: number,
  limit: number,
): Promise<Pick<CustomDomainRow, "id" | "user_id" | "hostname" | "cf_custom_hostname_id">[]> {
  const cutoff = Date.now() - staleAfterMs;
  const rows = await db
    .prepare(
      `SELECT id, user_id, hostname, cf_custom_hostname_id
         FROM custom_domains
        WHERE status IN ('active','provisioning','suspended')
          AND (last_active_check_at IS NULL OR last_active_check_at < ?)
        ORDER BY COALESCE(last_active_check_at, 0) ASC
        LIMIT ?`,
    )
    .bind(cutoff, limit)
    .all<Pick<CustomDomainRow, "id" | "user_id" | "hostname" | "cf_custom_hostname_id">>();
  return rows.results ?? [];
}
