/**
 * Intake session helpers — the 60-second "what do you want this scan
 * to emphasize?" flow that runs before the full 40-min scan.
 *
 * Lifecycle:
 *   pending → running → awaiting_answers → ready → consumed
 *                                              \__ abandoned / failed
 *
 * The worker (apps/worker/scripts/run-intake.ts) writes
 * questions_json; the web layer writes answers_json and transitions
 * to `consumed` when the full scan spawns.
 */

export interface IntakeQuestion {
  id: string;
  question: string;
  why?: string;
  options?: Array<{ value: string; label: string }>;
  default?: string;
}

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
  questions: Array<{
    id: string;
    question: string;
    why?: string;
    options?: Array<{ value: string; label: string }>;
    default?: string;
  }>;
  read_summary?: string;
  answers?: Record<string, string>;
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

  let questions: IntakeView["questions"] = [];
  let read_summary: string | undefined;
  if (row.questions_json) {
    try {
      const parsed = JSON.parse(row.questions_json) as {
        questions?: IntakeView["questions"];
        read_summary?: string;
      };
      questions = parsed.questions ?? [];
      read_summary = parsed.read_summary;
    } catch {
      /* tolerate malformed — the UI shows the "failed" state */
    }
  }

  let answers: Record<string, string> | undefined;
  if (row.answers_json) {
    try {
      answers = JSON.parse(row.answers_json) as Record<string, string>;
    } catch {
      /* tolerate */
    }
  }

  return {
    id: row.id,
    handle: row.handle,
    status: row.status,
    questions,
    read_summary,
    answers,
    scan_id: row.scan_id,
    error: row.error,
  };
}

export async function createIntakeSession(
  db: D1Database,
  params: { id: string; user_id: string; handle: string },
): Promise<void> {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO intake_sessions
         (id, user_id, handle, status, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', ?, ?)`,
    )
    .bind(params.id, params.user_id, params.handle, now, now)
    .run();
}

export async function saveIntakeAnswers(
  db: D1Database,
  intakeId: string,
  userId: string,
  answers: Record<string, string>,
): Promise<boolean> {
  const now = Date.now();
  const res = await db
    .prepare(
      `UPDATE intake_sessions
         SET answers_json = ?, status = 'ready', updated_at = ?
         WHERE id = ? AND user_id = ? AND status IN ('ready','awaiting_answers')`,
    )
    .bind(JSON.stringify(answers), now, intakeId, userId)
    .run();
  return (res.meta?.changes ?? 0) > 0;
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

/**
 * Flattens intake answers into a context_notes string fit for the
 * full scan. Each Q→A pair becomes a single line so the downstream
 * discover agent can read it as plain-English notes.
 */
export function buildContextFromIntake(intake: IntakeView): string | null {
  if (!intake.answers) return null;
  const parts: string[] = [];
  for (const q of intake.questions) {
    const a = intake.answers[q.id];
    if (!a) continue;
    parts.push(`Q: ${q.question}\nA: ${a}`);
  }
  return parts.length > 0 ? parts.join("\n\n") : null;
}

