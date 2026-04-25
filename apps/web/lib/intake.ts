/**
 * Intake session helpers — the URL-collection step that runs before
 * the full scan. The user lands on /app/intake/[id], pastes the
 * places we should look at (LinkedIn, blog, etc.), and submits to
 * spawn the scan.
 *
 * Lifecycle:
 *   ready → consumed
 *        \__ abandoned / failed
 *
 * (Earlier the worker generated 3-5 questions via an LLM and the
 * status enum had pending/running/awaiting_answers stages. That
 * step was removed because the questions influenced the scan in
 * ways the user couldn't see. The DB enum still allows those
 * statuses for older rows but new rows start at `ready`.)
 */
export interface IntakeRow {
  id: string;
  user_id: string;
  handle: string;
  status:
    | "pending"
    | "running"
    | "awaiting_answers"
    | "ready"
    | "consumed"
    | "abandoned"
    | "failed";
  pre_scan_r2_key: string | null;
  questions_json: string | null;
  answers_json: string | null;
  scan_id: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

export interface IntakeView {
  id: string;
  handle: string;
  status: IntakeRow["status"];
  scan_id: string | null;
  error: string | null;
}

export async function getIntakeForUser(
  db: D1Database,
  intakeId: string,
  userId: string,
): Promise<IntakeView | null> {
  const row = await db
    .prepare(`SELECT * FROM intake_sessions WHERE id = ? AND user_id = ?`)
    .bind(intakeId, userId)
    .first<IntakeRow>();
  if (!row) return null;
  return {
    id: row.id,
    handle: row.handle,
    status: row.status,
    scan_id: row.scan_id,
    error: row.error,
  };
}

export async function createIntakeSession(
  db: D1Database,
  params: { id: string; user_id: string; handle: string },
): Promise<void> {
  // status='ready' from the start — we no longer wait on a worker to
  // populate questions, so the URL form can render immediately.
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO intake_sessions
         (id, user_id, handle, status, created_at, updated_at)
       VALUES (?, ?, ?, 'ready', ?, ?)`,
    )
    .bind(params.id, params.user_id, params.handle, now, now)
    .run();
}

export async function markIntakeConsumed(
  db: D1Database,
  intakeId: string,
  userId: string,
  scanId: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE intake_sessions
         SET status = 'consumed', scan_id = ?, updated_at = ?, completed_at = ?
         WHERE id = ? AND user_id = ?`,
    )
    .bind(scanId, Date.now(), Date.now(), intakeId, userId)
    .run();
}
