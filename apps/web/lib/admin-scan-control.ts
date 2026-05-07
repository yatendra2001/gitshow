import "server-only";
import type { D1Database } from "@cloudflare/workers-types";
import { FlyClient } from "@gitshow/shared/cloud/fly";

/**
 * Operator-side scan recovery primitives. Shared by:
 *   - POST /api/admin/scans/[scanId]/force-fail
 *   - POST /api/admin/users/[userId]/rerun (calls forceFailScan first)
 *   - POST /api/cron/reap-stale-scans (loops over stuck scans)
 *
 * The two destructive primitives ALWAYS try to destroy the Fly machine
 * before flipping the D1 row, so a failed destroy still leaves the row
 * marked failed (D1 truth wins). Best-effort destroy is the right
 * trade-off — leaving a row stuck "running" because Fly was momentarily
 * unreachable would be worse than an orphan machine that exits on its
 * own (`restart_policy = no` on every scan machine).
 */

export interface ForceFailResult {
  ok: true;
  scan_id: string;
  machine_destroyed: boolean;
  machine_destroy_error?: string;
}

interface ScanControlRow {
  id: string;
  user_id: string;
  status: string;
  fly_machine_id: string | null;
}

/**
 * Mark a scan as failed and best-effort destroy its Fly machine.
 * Idempotent on already-terminal scans (returns ok with destroyed=false).
 */
export async function forceFailScan(
  db: D1Database,
  scanId: string,
  reason: string,
): Promise<ForceFailResult | { ok: false; error: string }> {
  const row = await db
    .prepare(
      `SELECT id, user_id, status, fly_machine_id
         FROM scans WHERE id = ? LIMIT 1`,
    )
    .bind(scanId)
    .first<ScanControlRow>();
  if (!row) return { ok: false, error: "not_found" };

  let destroyError: string | undefined;
  let destroyed = false;
  if (row.fly_machine_id) {
    try {
      const fly = FlyClient.fromEnv();
      await fly.destroyMachine(row.fly_machine_id, true);
      destroyed = true;
    } catch (err) {
      destroyError =
        err instanceof Error ? err.message.slice(0, 240) : String(err);
    }
  }

  // Only flip the row if it's still in flight. Already-terminal scans
  // keep their original status / completed_at so reruns of this helper
  // (e.g. cron reaper hitting the same scan twice) are no-ops.
  if (row.status === "queued" || row.status === "running") {
    await db
      .prepare(
        `UPDATE scans
            SET status = 'failed',
                completed_at = ?,
                error = COALESCE(error, ?)
          WHERE id = ?`,
      )
      .bind(Date.now(), reason.slice(0, 500), scanId)
      .run();
  }

  return {
    ok: true,
    scan_id: scanId,
    machine_destroyed: destroyed,
    ...(destroyError ? { machine_destroy_error: destroyError } : {}),
  };
}

/**
 * Find scans that are still running but haven't emitted any scan_event
 * in the last `idleMs`. Heartbeat alone isn't enough — Tanmay's hung
 * scan kept heart-beating from a separate setInterval while the
 * pipeline was deadlocked on a stalled LLM stream. Real progress shows
 * up as scan_events. If nothing's landed in 15 minutes, the scan is
 * stuck regardless of what `last_heartbeat` says.
 */
export interface StaleScanRow {
  id: string;
  user_id: string;
  handle: string;
  current_phase: string | null;
  last_heartbeat: number | null;
  fly_machine_id: string | null;
  created_at: number;
  last_event_at: number | null;
}

export async function listStaleScans(
  db: D1Database,
  idleMs: number,
): Promise<StaleScanRow[]> {
  const cutoff = Date.now() - idleMs;
  const result = await db
    .prepare(
      `SELECT s.id, s.user_id, s.handle, s.current_phase, s.last_heartbeat,
              s.fly_machine_id, s.created_at,
              (SELECT MAX(at) FROM scan_events WHERE scan_id = s.id) AS last_event_at
         FROM scans s
        WHERE s.status IN ('queued','running')
          AND COALESCE(
                (SELECT MAX(at) FROM scan_events WHERE scan_id = s.id),
                s.created_at
              ) < ?
        ORDER BY s.created_at ASC
        LIMIT 50`,
    )
    .bind(cutoff)
    .all<StaleScanRow>();
  return result.results ?? [];
}
