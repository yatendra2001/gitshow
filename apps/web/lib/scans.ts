/**
 * Scan + claim queries keyed to the native D1 binding. Keep shapes in
 * sync with migrations/0001_init.sql (scans, claims) and
 * migrations/0002_live_events.sql (scan_events widened).
 */
import type { CardClaim } from "@gitshow/shared/schemas";
import type { PipelineEvent } from "@gitshow/shared/events";

export interface ScanRow {
  id: string;
  user_id: string;
  handle: string;
  session_id: string;
  model: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  current_phase: string | null;
  last_completed_phase: string | null;
  fly_machine_id: string | null;
  last_heartbeat: number | null;
  error: string | null;
  cost_cents: number;
  llm_calls: number;
  hook_similarity: number | null;
  hiring_verdict: string | null;
  hiring_score: number | null;
  socials_json: string | null;
  context_notes: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

export interface ScanEventRow {
  id: number;
  scan_id: string;
  kind: PipelineEvent["kind"];
  stage: string | null;
  worker: string | null;
  status: string | null;
  duration_ms: number | null;
  message: string | null;
  data_json: string | null;
  at: number;
}

export interface ClaimRow {
  id: string;
  scan_id: string;
  beat: string;
  idx: number;
  text: string;
  label: string | null;
  sublabel: string | null;
  evidence_ids: string;
  confidence: string;
  status: string;
  original_text: string | null;
  created_at: number;
  updated_at: number;
}

export async function getScanById(
  db: D1Database,
  scanId: string,
): Promise<ScanRow | null> {
  return (await db
    .prepare(`SELECT * FROM scans WHERE id = ? LIMIT 1`)
    .bind(scanId)
    .first<ScanRow>());
}

export async function getScanByIdForUser(
  db: D1Database,
  scanId: string,
  userId: string,
): Promise<ScanRow | null> {
  return (await db
    .prepare(`SELECT * FROM scans WHERE id = ? AND user_id = ? LIMIT 1`)
    .bind(scanId, userId)
    .first<ScanRow>());
}

export async function listEventsSince(
  db: D1Database,
  scanId: string,
  sinceId: number,
  limit = 200,
): Promise<ScanEventRow[]> {
  const resp = await db
    .prepare(
      `SELECT * FROM scan_events
         WHERE scan_id = ? AND id > ?
         ORDER BY id ASC
         LIMIT ?`,
    )
    .bind(scanId, sinceId, limit)
    .all<ScanEventRow>();
  return resp.results ?? [];
}

export async function listClaimsForScan(
  db: D1Database,
  scanId: string,
): Promise<ClaimRow[]> {
  const resp = await db
    .prepare(
      `SELECT * FROM claims WHERE scan_id = ? ORDER BY beat ASC, idx ASC`,
    )
    .bind(scanId)
    .all<ClaimRow>();
  return resp.results ?? [];
}

export async function updateClaimStatus(
  db: D1Database,
  claimId: string,
  patch: { status?: string; text?: string; original_text?: string },
): Promise<void> {
  const sets: string[] = ["updated_at = ?"];
  const params: (string | number | null)[] = [Date.now()];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    sets.push(`${k} = ?`);
    params.push(v);
  }
  params.push(claimId);
  await db
    .prepare(`UPDATE claims SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...params)
    .run();
}

export function claimRowToCardShape(row: ClaimRow): Partial<CardClaim> & {
  id: string;
} {
  const evIds = JSON.parse(row.evidence_ids) as string[];
  return {
    id: row.id,
    beat: row.beat as CardClaim["beat"],
    text: row.text,
    label: row.label ?? undefined,
    sublabel: row.sublabel ?? undefined,
    confidence: row.confidence as CardClaim["confidence"],
    status: row.status as CardClaim["status"],
    evidence_count: evIds.length,
  };
}

export function parseEventRow(row: ScanEventRow): PipelineEvent {
  // Best-effort reconstruction. Structured events carry `data_json`;
  // stage boundaries only use the flat columns.
  if (row.data_json) {
    try {
      const parsed = JSON.parse(row.data_json);
      if (parsed && typeof parsed === "object" && "kind" in parsed) {
        return parsed as PipelineEvent;
      }
    } catch {
      /* fall through to flat reconstruction */
    }
  }
  switch (row.kind) {
    case "stage-start":
      return {
        kind: "stage-start",
        stage: row.stage ?? "",
        detail: row.message ?? undefined,
      };
    case "stage-end":
      return {
        kind: "stage-end",
        stage: row.stage ?? "",
        duration_ms: row.duration_ms ?? 0,
        detail: row.message ?? undefined,
      };
    case "stage-warn":
      return {
        kind: "stage-warn",
        stage: row.stage ?? "",
        message: row.message ?? "",
      };
    case "worker-update":
      return {
        kind: "worker-update",
        worker: row.worker ?? "",
        status: (row.status ?? "running") as "running" | "done" | "failed",
        detail: row.message ?? undefined,
      };
    case "error":
      return {
        kind: "error",
        stage: row.stage ?? undefined,
        message: row.message ?? "",
      };
    default:
      return {
        kind: row.kind,
        // Upstream always includes `data_json` for the richer kinds; if
        // we got here without it the event is malformed. Return a minimal
        // shell so the client can at least display "something happened".
        stage: row.stage ?? undefined,
        message: row.message ?? "",
      } as unknown as PipelineEvent;
  }
}
