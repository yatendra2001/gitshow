/**
 * Security primitives for the custom-domains feature.
 *
 *   - HMAC verification tokens bound to (user_id, hostname). Even if
 *     leaked, they're useless to anyone else trying to claim a domain.
 *   - Rate limiter using `domain_rate_limits` (D1 token bucket).
 *   - Audit log helper for `domain_events` rows.
 *
 * The HMAC secret is derived from `AUTH_SECRET` so we don't add yet
 * another env var. AUTH_SECRET is already required at boot (auth.ts
 * fails loudly without it), so a missing key would fail-closed.
 */

import type { D1Database } from "@cloudflare/workers-types";

// CloudflareEnv is a global interface declared in cloudflare-env.d.ts.

const enc = new TextEncoder();

// ─── HMAC verification token ───────────────────────────────────────────

/**
 * Generate a verification token bound to (user_id, hostname).
 * Format: `gitshow-verify=<24 random hex>.<HMAC>`. The user pastes the
 * full string into a TXT record. We re-derive the HMAC at verify time
 * and compare in constant time.
 */
export async function mintVerificationToken(
  env: CloudflareEnv,
  userId: string,
  hostname: string,
): Promise<string> {
  const random = crypto.getRandomValues(new Uint8Array(12));
  const nonce = Array.from(random, (b) => b.toString(16).padStart(2, "0")).join("");
  const sig = await hmacHex(env, `${userId}:${hostname}:${nonce}`);
  return `gitshow-verify=${nonce}.${sig}`;
}

/**
 * Validate a token claim. Returns true only if the HMAC verifies for
 * the given (user_id, hostname). Constant-time comparison.
 */
export async function checkVerificationToken(
  env: CloudflareEnv,
  userId: string,
  hostname: string,
  token: string,
): Promise<boolean> {
  const m = /^gitshow-verify=([a-f0-9]+)\.([a-f0-9]+)$/.exec(token);
  if (!m) return false;
  const [, nonce, sig] = m;
  const expected = await hmacHex(env, `${userId}:${hostname}:${nonce}`);
  return safeEqual(sig!, expected);
}

async function hmacHex(env: CloudflareEnv, message: string): Promise<string> {
  const secret = env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required for domain verification");
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret + ":domains"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

// ─── Rate limiter ──────────────────────────────────────────────────────

/**
 * Per-bucket sliding window. Each unique `bucket_key` lives in
 * `domain_rate_limits`. When the existing window has expired we reset
 * the count; otherwise we increment.
 *
 * D1 doesn't give us atomic INCR-or-INSERT, so we run it as a
 * transaction-friendly UPSERT. Worst case (hot contention) we
 * over-count by 1 per concurrent request — fine for rate limiting.
 *
 * Returns `{ ok: true }` if the action is allowed, else
 * `{ ok: false, retryAfterSec }` for the caller to put in a 429
 * response.
 */
export async function checkRateLimit(
  db: D1Database,
  bucketKey: string,
  limit: number,
  windowSec: number,
): Promise<{ ok: true } | { ok: false; retryAfterSec: number }> {
  const now = Date.now();
  const windowMs = windowSec * 1000;

  const row = await db
    .prepare(
      `SELECT count, window_start FROM domain_rate_limits WHERE bucket_key = ?`,
    )
    .bind(bucketKey)
    .first<{ count: number; window_start: number }>();

  if (!row) {
    await db
      .prepare(
        `INSERT INTO domain_rate_limits (bucket_key, count, window_start) VALUES (?, 1, ?)`,
      )
      .bind(bucketKey, now)
      .run();
    return { ok: true };
  }

  const expired = now - row.window_start > windowMs;
  if (expired) {
    await db
      .prepare(
        `UPDATE domain_rate_limits SET count = 1, window_start = ? WHERE bucket_key = ?`,
      )
      .bind(now, bucketKey)
      .run();
    return { ok: true };
  }

  if (row.count >= limit) {
    const retryAfterSec = Math.max(
      1,
      Math.ceil((row.window_start + windowMs - now) / 1000),
    );
    return { ok: false, retryAfterSec };
  }

  await db
    .prepare(
      `UPDATE domain_rate_limits SET count = count + 1 WHERE bucket_key = ?`,
    )
    .bind(bucketKey)
    .run();
  return { ok: true };
}

export const RATE_LIMITS = {
  add: { limit: 5, windowSec: 60 * 60 }, // 5 / hour
  verify: { limit: 12, windowSec: 60 * 60 }, // 12 / hour
  gemini: { limit: 5, windowSec: 60 * 60 }, // 5 / hour
  ipAdd: { limit: 20, windowSec: 60 * 60 * 24 }, // 20 / day per IP
} as const;

export type RateLimitKind = keyof typeof RATE_LIMITS;

export function bucketKey(kind: RateLimitKind, userOrIp: string): string {
  return `${kind}:${kind === "ipAdd" ? "ip" : "user"}:${userOrIp}`;
}

// ─── Audit log ─────────────────────────────────────────────────────────

export type DomainEventType =
  | "created"
  | "verify_attempt"
  | "dns_verified"
  | "ssl_issued"
  | "activated"
  | "suspended"
  | "reactivated"
  | "failed"
  | "deleted"
  | "admin_takedown";

export interface AuditEntry {
  customDomainId: string;
  userId: string;
  eventType: DomainEventType;
  prevStatus?: string | null;
  newStatus?: string | null;
  actor: "user" | "system" | "admin";
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

export async function recordAudit(db: D1Database, entry: AuditEntry): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO domain_events
           (custom_domain_id, user_id, event_type, prev_status, new_status,
            actor, ip, user_agent, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        entry.customDomainId,
        entry.userId,
        entry.eventType,
        entry.prevStatus ?? null,
        entry.newStatus ?? null,
        entry.actor,
        entry.ip ?? null,
        entry.userAgent ? entry.userAgent.slice(0, 255) : null,
        entry.metadata ? JSON.stringify(entry.metadata).slice(0, 4000) : null,
        Date.now(),
      )
      .run();
  } catch {
    // Audit failures must never break the user-facing flow.
  }
}

// ─── Tombstone helpers ─────────────────────────────────────────────────

/**
 * Tombstone status for a hostname. Returns the previous owner's user_id
 * so the caller can decide whether to enforce the cooldown — same-user
 * re-claims are allowed immediately (no security benefit to blocking
 * them, just friction).
 */
export async function isHostnameTombstoned(
  db: D1Database,
  hostname: string,
): Promise<{
  tombstoned: boolean;
  cooldownUntil: number | null;
  previousUserId: string | null;
}> {
  const row = await db
    .prepare(
      `SELECT cooldown_until, previous_user_id FROM released_hostnames WHERE hostname = ?`,
    )
    .bind(hostname)
    .first<{ cooldown_until: number; previous_user_id: string | null }>();
  if (!row) {
    return { tombstoned: false, cooldownUntil: null, previousUserId: null };
  }
  if (row.cooldown_until <= Date.now()) {
    return {
      tombstoned: false,
      cooldownUntil: row.cooldown_until,
      previousUserId: row.previous_user_id,
    };
  }
  return {
    tombstoned: true,
    cooldownUntil: row.cooldown_until,
    previousUserId: row.previous_user_id,
  };
}

export async function tombstoneHostname(
  db: D1Database,
  hostname: string,
  previousUserId: string,
): Promise<void> {
  const now = Date.now();
  const cooldownUntil = now + 30 * 24 * 60 * 60 * 1000; // 30 days
  await db
    .prepare(
      `INSERT INTO released_hostnames (hostname, previous_user_id, released_at, cooldown_until)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(hostname) DO UPDATE SET
         previous_user_id = excluded.previous_user_id,
         released_at = excluded.released_at,
         cooldown_until = excluded.cooldown_until`,
    )
    .bind(hostname, previousUserId, now, cooldownUntil)
    .run();
}

// ─── CNAME target — single source of truth ─────────────────────────────

/**
 * The target hostname users CNAME to. Industry convention: dedicated
 * subdomain so we can change the underlying target (Worker, fallback
 * origin, region) without touching customer DNS.
 *
 * Configured once on our Cloudflare zone:
 *   `cname.gitshow.io  CNAME  gitshow-web.workers.dev` (proxied)
 */
export const CNAME_TARGET = "cname.gitshow.io";
