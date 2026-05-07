#!/usr/bin/env bun
/**
 * Programmatically re-trigger a scan for a user. Mirrors the
 * /api/admin/users/[userId]/rerun endpoint logic but runs from the
 * worker shell instead of needing an admin session cookie. Useful
 * after manually recovering hung scans.
 *
 * - Pulls config (handle, model, socials, context_notes) from the
 *   user's most recent scan row in D1.
 * - Reads the user's GitHub OAuth access token from the `account`
 *   table (Better Auth schema, providerId='github').
 * - Force-fails any in-flight scans for the user.
 * - Inserts a new `queued` scan row, then spawns a Fly machine via
 *   the Machines API.
 *
 * Usage:
 *   bun scripts/rerun-scan.ts --scan <prior_scan_id> [--scan ...]
 *   bun scripts/rerun-scan.ts --user <user_id> [--user ...]
 *   bun scripts/rerun-scan.ts --handle <gh_login> [--handle ...]
 *   bun scripts/rerun-scan.ts ... --dry-run
 */
import "dotenv/config";
import { nanoid } from "nanoid";
import { FlyClient } from "@gitshow/shared/cloud/fly";
import { DEFAULT_SCAN_MODEL } from "@gitshow/shared/models";

interface Args {
  scans: string[];
  users: string[];
  handles: string[];
  dryRun: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const a: Args = { scans: [], users: [], handles: [], dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const cur = argv[i];
    const next = argv[i + 1];
    if (cur === "--scan" && next) {
      a.scans.push(next);
      i++;
    } else if (cur === "--user" && next) {
      a.users.push(next);
      i++;
    } else if (cur === "--handle" && next) {
      a.handles.push(next);
      i++;
    } else if (cur === "--dry-run") {
      a.dryRun = true;
    }
  }
  return a;
}

const accountId = process.env.CF_ACCOUNT_ID!;
const databaseId = process.env.D1_DATABASE_ID!;
const cfToken = process.env.CF_API_TOKEN!;
const d1Url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;

async function d1<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await fetch(d1Url, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ sql, params }),
  });
  if (!r.ok) throw new Error(`d1 ${r.status}: ${await r.text()}`);
  const j = (await r.json()) as { result?: Array<{ results?: T[] }>; errors?: Array<{ message: string }> };
  if (j.errors?.length) throw new Error(`d1 errors: ${j.errors.map((e) => e.message).join("; ")}`);
  return j.result?.[0]?.results ?? [];
}

interface PriorScan {
  id: string;
  user_id: string;
  handle: string;
  model: string | null;
  socials_json: string | null;
  context_notes: string | null;
  status: string;
}

async function findPriorScan(args: Args): Promise<Map<string, PriorScan>> {
  const map = new Map<string, PriorScan>(); // keyed by user_id

  for (const scanId of args.scans) {
    const [row] = await d1<PriorScan>(
      `SELECT id, user_id, handle, model, socials_json, context_notes, status
         FROM scans WHERE id = ? LIMIT 1`,
      [scanId],
    );
    if (!row) {
      console.warn(`scan ${scanId}: not found`);
      continue;
    }
    map.set(row.user_id, row);
  }

  for (const userId of args.users) {
    if (map.has(userId)) continue;
    const [row] = await d1<PriorScan>(
      `SELECT id, user_id, handle, model, socials_json, context_notes, status
         FROM scans WHERE user_id = ?
         ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );
    if (!row) {
      console.warn(`user ${userId}: no prior scan`);
      continue;
    }
    map.set(row.user_id, row);
  }

  for (const handle of args.handles) {
    const [user] = await d1<{ id: string }>(
      `SELECT id FROM users WHERE LOWER(login) = LOWER(?) LIMIT 1`,
      [handle],
    );
    if (!user) {
      console.warn(`handle @${handle}: user not found`);
      continue;
    }
    if (map.has(user.id)) continue;
    const [row] = await d1<PriorScan>(
      `SELECT id, user_id, handle, model, socials_json, context_notes, status
         FROM scans WHERE user_id = ?
         ORDER BY created_at DESC LIMIT 1`,
      [user.id],
    );
    if (!row) {
      console.warn(`handle @${handle}: no prior scan for user ${user.id}`);
      continue;
    }
    map.set(row.user_id, row);
  }

  return map;
}

async function getUserGhToken(userId: string): Promise<string | null> {
  const [row] = await d1<{ accessToken: string | null }>(
    `SELECT accessToken FROM account
       WHERE userId = ? AND providerId = 'github' AND accessToken IS NOT NULL
       ORDER BY updatedAt DESC LIMIT 1`,
    [userId],
  );
  return row?.accessToken ?? null;
}

async function forceFailInFlight(userId: string): Promise<string[]> {
  const inflight = await d1<{ id: string; fly_machine_id: string | null }>(
    `SELECT id, fly_machine_id FROM scans
       WHERE user_id = ? AND status IN ('queued','running')
       ORDER BY created_at DESC`,
    [userId],
  );
  for (const row of inflight) {
    if (row.fly_machine_id) {
      try {
        await fetch(
          `https://api.machines.dev/v1/apps/${process.env.FLY_APP_NAME}/machines/${row.fly_machine_id}?force=true`,
          { method: "DELETE", headers: { Authorization: `Bearer ${process.env.FLY_API_TOKEN}` } },
        );
      } catch {
        // ignore — script will mark failed in D1 either way
      }
    }
    await d1(
      `UPDATE scans SET status='failed', error='superseded by manual rerun', updated_at=? WHERE id=?`,
      [Date.now(), row.id],
    );
  }
  return inflight.map((r) => r.id);
}

function safeJsonObject(raw: string | null | undefined): {
  twitter?: string;
  linkedin?: string;
  website?: string;
  youtube?: string;
  orcid?: string;
  stackoverflow?: string;
} {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return typeof v === "object" && v ? v : {};
  } catch {
    return {};
  }
}

function buildEnv(opts: {
  scanId: string;
  handle: string;
  model: string;
  socials: ReturnType<typeof safeJsonObject>;
  contextNotes: string | null;
  ghToken: string;
}): Record<string, string> {
  const env: Record<string, string> = {
    SCAN_ID: opts.scanId,
    HANDLE: opts.handle,
    MODEL: opts.model,
    PIPELINE: "resume",
    GITSHOW_CLOUD_MODE: "1",
    CF_ACCOUNT_ID: required("CF_ACCOUNT_ID"),
    CF_API_TOKEN: required("CF_API_TOKEN"),
    D1_DATABASE_ID: required("D1_DATABASE_ID"),
    R2_BUCKET_NAME: required("R2_BUCKET_NAME"),
    R2_ACCESS_KEY_ID: required("R2_ACCESS_KEY_ID"),
    R2_SECRET_ACCESS_KEY: required("R2_SECRET_ACCESS_KEY"),
    OPENROUTER_API_KEY: required("OPENROUTER_API_KEY"),
    GH_TOKEN: opts.ghToken,
  };
  if (opts.socials.twitter) env.TWITTER = opts.socials.twitter;
  if (opts.socials.linkedin) env.LINKEDIN = opts.socials.linkedin;
  if (opts.socials.website) env.WEBSITE = opts.socials.website;
  if (opts.socials.youtube) env.YOUTUBE = opts.socials.youtube;
  if (opts.socials.orcid) env.ORCID = opts.socials.orcid;
  if (opts.socials.stackoverflow) env.STACKOVERFLOW = opts.socials.stackoverflow;
  if (opts.contextNotes) env.CONTEXT_NOTES = opts.contextNotes;
  if (process.env.REALTIME_ENDPOINT) env.REALTIME_ENDPOINT = process.env.REALTIME_ENDPOINT;
  if (process.env.PIPELINE_SHARED_SECRET)
    env.PIPELINE_SHARED_SECRET = process.env.PIPELINE_SHARED_SECRET;
  if (process.env.RESEND_API_KEY) env.RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (process.env.EMAIL_FROM) env.EMAIL_FROM = process.env.EMAIL_FROM;
  if (process.env.PUBLIC_APP_URL) env.PUBLIC_APP_URL = process.env.PUBLIC_APP_URL;
  if (process.env.TINYFISH_API_KEY) env.TINYFISH_API_KEY = process.env.TINYFISH_API_KEY;
  return env;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env: ${name}`);
  return v;
}

const args = parseArgs();
if (args.scans.length === 0 && args.users.length === 0 && args.handles.length === 0) {
  console.error(
    "Usage: bun scripts/rerun-scan.ts --scan <id> | --user <id> | --handle <login> [--dry-run]",
  );
  process.exit(1);
}

const targets = await findPriorScan(args);
if (targets.size === 0) {
  console.error("nothing to rerun");
  process.exit(1);
}

console.log(`Re-triggering ${targets.size} scan(s)${args.dryRun ? " (DRY RUN)" : ""}:`);
const fly = args.dryRun ? null : FlyClient.fromEnv();

for (const [userId, prior] of targets) {
  console.log(`\n[user ${userId}] @${prior.handle} (prior scan: ${prior.id}, status: ${prior.status})`);

  const ghToken = await getUserGhToken(userId);
  if (!ghToken) {
    console.error(`  ✗ no GitHub OAuth token on file — user must reconnect`);
    continue;
  }

  if (args.dryRun) {
    console.log(
      `  → DRY RUN: would force-fail in-flights for user, insert new scan row, spawn fly machine`,
    );
    continue;
  }

  const superseded = await forceFailInFlight(userId);
  if (superseded.length > 0) {
    console.log(`  • force-failed in-flight scans: ${superseded.join(", ")}`);
  }

  const newScanId = `scan-${nanoid(10)}`;
  const sessionId = `or-${nanoid(14)}`;
  const model = prior.model ?? DEFAULT_SCAN_MODEL;
  const socials = safeJsonObject(prior.socials_json);
  const now = Date.now();

  await d1(
    `INSERT INTO scans
       (id, user_id, handle, session_id, model, status, current_phase,
        cost_cents, llm_calls, socials_json, context_notes,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'queued', NULL, 0, 0, ?, ?, ?, ?)`,
    [
      newScanId,
      userId,
      prior.handle,
      sessionId,
      model,
      prior.socials_json,
      prior.context_notes,
      now,
      now,
    ],
  );
  console.log(`  • inserted ${newScanId} (queued)`);

  try {
    const machine = await fly!.spawnScanMachine({
      scanId: newScanId,
      env: buildEnv({
        scanId: newScanId,
        handle: prior.handle,
        model,
        socials,
        contextNotes: prior.context_notes,
        ghToken,
      }),
    });
    await d1(
      `UPDATE scans SET fly_machine_id = ?, updated_at = ? WHERE id = ?`,
      [machine.id, Date.now(), newScanId],
    );
    console.log(`  ✓ spawned machine ${machine.id} (${machine.region}) → scan ${newScanId}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await d1(
      `UPDATE scans SET status='failed', error=?, updated_at=? WHERE id=?`,
      [`fly spawn (manual rerun): ${msg.slice(0, 480)}`, Date.now(), newScanId],
    );
    console.error(`  ✗ fly spawn failed: ${msg}`);
  }
}

console.log("\nDone.");
