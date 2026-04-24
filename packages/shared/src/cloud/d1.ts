/**
 * Minimal Cloudflare D1 HTTP client. Works in both Node.js (Fly worker) and
 * Cloudflare Workers. For Workers, prefer the native `env.DB` binding —
 * this client hits the REST API and is meant for out-of-Workers callers.
 *
 * ── Resilience ──
 * `query()` retries on transient failures (network errors, 5xx responses,
 * 429 rate limits) with exponential backoff + jitter. Permanent errors
 * (4xx other than 429, SQL errors) throw immediately — retrying a bad
 * query just wastes time.
 *
 * Every final failure (after retries exhausted) increments `failureCount`,
 * logs through the injected logger, and fires `onFailure` if registered.
 */
import { requireEnv, sleep, consoleLogger, type Logger } from "../util";

export interface D1Config {
  accountId: string;
  databaseId: string;
  apiToken: string;
  logger?: Logger;
}

interface D1QueryResponse {
  success: boolean;
  errors?: Array<{ code?: number; message: string }>;
  messages?: Array<{ message: string }>;
  result?: Array<{
    results?: Array<Record<string, unknown>>;
    success?: boolean;
    meta?: { duration?: number; changes?: number; last_row_id?: number };
  }>;
}

export type D1Param = string | number | boolean | null;

export interface RetryOptions {
  /** Total attempts, including the first try. Default 3. */
  attempts?: number;
  /** Base backoff delay in ms. Default 500. */
  baseDelayMs?: number;
  /** Max backoff cap in ms. Default 4000. */
  maxDelayMs?: number;
}

export interface D1FailureInfo {
  sqlPreview: string;
  /** Actual attempts made before giving up (1 for permanent errors). */
  attempts: number;
  error: string;
  status?: number;
}

const DEFAULT_RETRY: Required<RetryOptions> = {
  attempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 4000,
};

export class D1Client {
  private endpoint: string;
  private apiToken: string;
  private log: Logger;
  private _failureCount = 0;
  private _lastFailureAt: number | null = null;
  /** Optional listener; fires once per fully-failed query. */
  onFailure: ((info: D1FailureInfo) => void) | null = null;

  constructor(cfg: D1Config) {
    this.endpoint = `https://api.cloudflare.com/client/v4/accounts/${cfg.accountId}/d1/database/${cfg.databaseId}/query`;
    this.apiToken = cfg.apiToken;
    this.log = cfg.logger ?? consoleLogger;
  }

  static fromEnv(opts?: { logger?: Logger }): D1Client {
    const accountId = requireEnv("CF_ACCOUNT_ID");
    const databaseId = requireEnv("D1_DATABASE_ID");
    const apiToken = requireEnv("CF_API_TOKEN");
    return new D1Client({ accountId, databaseId, apiToken, logger: opts?.logger });
  }

  get failureCount(): number {
    return this._failureCount;
  }

  get lastFailureAt(): number | null {
    return this._lastFailureAt;
  }

  async query(
    sql: string,
    params: D1Param[] = [],
    retry?: RetryOptions,
  ): Promise<D1QueryResponse> {
    const attempts = retry?.attempts ?? DEFAULT_RETRY.attempts;
    const baseDelayMs = retry?.baseDelayMs ?? DEFAULT_RETRY.baseDelayMs;
    const maxDelayMs = retry?.maxDelayMs ?? DEFAULT_RETRY.maxDelayMs;

    let lastErr: unknown;
    let lastStatus: number | undefined;
    let attemptsMade = 0;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      attemptsMade = attempt;
      try {
        const resp = await fetch(this.endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ sql, params }),
        });

        if (!resp.ok) {
          const text = await resp.text();
          lastStatus = resp.status;
          lastErr = new Error(`d1 http ${resp.status}: ${text}`);
          if (!isRetriableStatus(resp.status) || attempt === attempts) {
            break;
          }
        } else {
          const json = (await resp.json()) as D1QueryResponse;
          if (!json.success) {
            const msg = json.errors?.[0]?.message ?? "d1 query failed";
            lastErr = new Error(`d1: ${msg}`);
            break;
          }
          return json;
        }
      } catch (netErr) {
        lastErr = netErr;
        if (attempt === attempts) break;
      }

      const raw = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      const jittered = raw * (0.75 + Math.random() * 0.5);
      await sleep(jittered);
    }

    this._failureCount++;
    this._lastFailureAt = Date.now();
    const failure: D1FailureInfo = {
      sqlPreview: sql.replace(/\s+/g, " ").slice(0, 100),
      attempts: attemptsMade,
      error: lastErr instanceof Error ? lastErr.message : String(lastErr),
      status: lastStatus,
    };
    this.log.error(failure, "d1.query.failed");
    this.onFailure?.(failure);
    throw lastErr;
  }

  async updateScanStatus(
    scanId: string,
    patch: {
      status?: "queued" | "running" | "succeeded" | "failed" | "cancelled";
      current_phase?: string | null;
      last_completed_phase?: string | null;
      error?: string | null;
      fly_machine_id?: string | null;
      completed_at?: number | null;
    },
  ): Promise<void> {
    const sets: string[] = ["updated_at = ?"];
    const params: D1Param[] = [Date.now()];

    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      sets.push(`${k} = ?`);
      params.push(v as D1Param);
    }
    params.push(scanId);

    await this.query(
      `UPDATE scans SET ${sets.join(", ")} WHERE id = ?`,
      params,
    );
  }

  async updateScanCompletion(
    scanId: string,
    patch: {
      cost_cents: number;
      llm_calls: number;
      hook_similarity?: number | null;
      hiring_verdict?: string | null;
      hiring_score?: number | null;
    },
  ): Promise<void> {
    await this.query(
      `UPDATE scans SET
        status = 'succeeded',
        cost_cents = ?,
        llm_calls = ?,
        hook_similarity = ?,
        hiring_verdict = ?,
        hiring_score = ?,
        current_phase = 'complete',
        last_completed_phase = 'bind',
        completed_at = ?,
        updated_at = ?,
        error = NULL
       WHERE id = ?`,
      [
        patch.cost_cents,
        patch.llm_calls,
        patch.hook_similarity ?? null,
        patch.hiring_verdict ?? null,
        patch.hiring_score ?? null,
        Date.now(),
        Date.now(),
        scanId,
      ],
    );
  }

  /**
   * Write the post-github-fetch snapshot onto the scan row so the
   * progress page + the scan-complete card can show locked orgs +
   * data-source counts. Both fields are JSON TEXT (see migration 0011).
   */
  async updateScanFetchSnapshot(
    scanId: string,
    patch: {
      access_state: unknown;
      data_sources: unknown;
    },
  ): Promise<void> {
    await this.query(
      `UPDATE scans SET
         access_state = ?,
         data_sources = ?,
         updated_at = ?
       WHERE id = ?`,
      [
        JSON.stringify(patch.access_state),
        JSON.stringify(patch.data_sources),
        Date.now(),
        scanId,
      ],
    );
  }

  async heartbeat(scanId: string): Promise<void> {
    const now = Date.now();
    await this.query(
      `UPDATE scans SET last_heartbeat = ?, updated_at = ? WHERE id = ?`,
      [now, now, scanId],
    );
  }

  async insertEvent(
    scanId: string,
    ev: {
      kind: import("../events.js").PersistedEventKind;
      stage?: string | null;
      worker?: string | null;
      status?: string | null;
      duration_ms?: number | null;
      message?: string | null;
      data_json?: unknown | null;
      parent_id?: string | null;
      message_id?: string | null;
    },
  ): Promise<void> {
    await this.query(
      `INSERT INTO scan_events
         (scan_id, kind, stage, worker, status, duration_ms, message, data_json, parent_id, message_id, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        scanId,
        ev.kind,
        ev.stage ?? null,
        ev.worker ?? null,
        ev.status ?? null,
        ev.duration_ms ?? null,
        ev.message ?? null,
        ev.data_json == null ? null : JSON.stringify(ev.data_json),
        ev.parent_id ?? null,
        ev.message_id ?? null,
        Date.now(),
      ],
    );
  }

  async upsertClaim(
    scanId: string,
    claim: {
      id: string;
      beat: string;
      idx: number;
      text: string;
      label?: string | null;
      sublabel?: string | null;
      evidence_ids: string[];
      confidence: string;
      status?: string;
    },
  ): Promise<void> {
    const now = Date.now();
    await this.query(
      `INSERT INTO claims
         (id, scan_id, beat, idx, text, label, sublabel, evidence_ids, confidence, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         beat = excluded.beat,
         idx = excluded.idx,
         text = excluded.text,
         label = excluded.label,
         sublabel = excluded.sublabel,
         evidence_ids = excluded.evidence_ids,
         confidence = excluded.confidence,
         updated_at = excluded.updated_at`,
      [
        claim.id,
        scanId,
        claim.beat,
        claim.idx,
        claim.text,
        claim.label ?? null,
        claim.sublabel ?? null,
        JSON.stringify(claim.evidence_ids),
        claim.confidence,
        claim.status ?? "ai_draft",
        now,
        now,
      ],
    );
  }

  // ─── Notifications (worker-initiated) ─────────────────────────────
  //
  // The worker creates notifications directly to avoid an HTTP
  // round-trip back through the web app. In-app delivery is instant
  // (user's next inbox fetch sees it); email + push are handled by
  // follow-up code that reads the row and dispatches.

  async createNotification(params: {
    id: string;
    user_id: string;
    kind: string;
    scan_id?: string | null;
    title: string;
    body?: string | null;
    action_url?: string | null;
    payload?: unknown;
  }): Promise<void> {
    await this.query(
      `INSERT INTO notifications
         (id, user_id, kind, scan_id, title, body, action_url, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
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
      ],
    );
  }

  async getUserIdForScan(scanId: string): Promise<string | null> {
    const resp = await this.query(
      `SELECT user_id FROM scans WHERE id = ? LIMIT 1`,
      [scanId],
    );
    const rows = (resp.result?.[0]?.results ?? []) as Array<{ user_id: string }>;
    return rows[0]?.user_id ?? null;
  }

  async getUserContactById(
    userId: string,
  ): Promise<{ email: string | null; name: string | null } | null> {
    const resp = await this.query(
      `SELECT email, name FROM users WHERE id = ? LIMIT 1`,
      [userId],
    );
    const rows = (resp.result?.[0]?.results ?? []) as Array<{
      email: string | null;
      name: string | null;
    }>;
    return rows[0] ?? null;
  }

  // ─── Worker control polling ──────────────────────────────────────
  //
  // The browser never polls (see apps/web/lib/use-scan-stream.ts), but
  // server-to-server control + answer polling is cheap and keeps the
  // orchestration simple. Workers call these every ~2s.

  async getPendingControls(
    scanId: string,
  ): Promise<Array<{ id: number; action: string; target_stage: string | null }>> {
    const resp = await this.query(
      `SELECT id, action, target_stage FROM scan_controls
         WHERE scan_id = ? AND acked_at IS NULL
         ORDER BY id ASC`,
      [scanId],
    );
    return (resp.result?.[0]?.results ?? []) as Array<{
      id: number;
      action: string;
      target_stage: string | null;
    }>;
  }

  async ackControl(controlId: number): Promise<void> {
    await this.query(
      `UPDATE scan_controls SET acked_at = ? WHERE id = ?`,
      [Date.now(), controlId],
    );
  }

  async getPendingAnswerForQuestion(
    questionId: string,
  ): Promise<{ answer: string | null; source: string } | null> {
    const resp = await this.query(
      `SELECT answer, source FROM agent_answers WHERE question_id = ? LIMIT 1`,
      [questionId],
    );
    const rows = (resp.result?.[0]?.results ?? []) as Array<{
      answer: string | null;
      source: string;
    }>;
    return rows[0] ?? null;
  }

  /**
   * Upsert the single-person user_profiles row for this user.
   * Called by the worker at the end of a successful scan to point
   * gitshow.io/{handle} at the freshly-emitted 14-card.json.
   */
  async upsertUserProfile(params: {
    user_id: string;
    handle: string;
    scan_id: string;
    card_r2_key: string;
  }): Promise<void> {
    const now = Date.now();
    const slug = params.handle.toLowerCase();
    await this.query(
      `INSERT INTO user_profiles
         (user_id, handle, public_slug, current_scan_id, current_profile_r2_key,
          first_scan_at, last_scan_at, revision_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         handle = excluded.handle,
         public_slug = excluded.public_slug,
         current_scan_id = excluded.current_scan_id,
         current_profile_r2_key = excluded.current_profile_r2_key,
         last_scan_at = excluded.last_scan_at,
         updated_at = excluded.updated_at`,
      [
        params.user_id,
        params.handle,
        slug,
        params.scan_id,
        params.card_r2_key,
        now,
        now,
        now,
        now,
      ],
    );
  }

  async createAgentQuestion(params: {
    id: string;
    scan_id: string;
    message_id?: string | null;
    stage: string;
    question: string;
    options?: Array<{ value: string; label: string }>;
    default_answer?: string | null;
    timeout_ms: number;
  }): Promise<void> {
    const now = Date.now();
    await this.query(
      `INSERT INTO agent_questions
         (id, scan_id, message_id, stage, question, options_json, default_answer, timeout_ms, asked_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        params.id,
        params.scan_id,
        params.message_id ?? null,
        params.stage,
        params.question,
        params.options ? JSON.stringify(params.options) : null,
        params.default_answer ?? null,
        params.timeout_ms,
        now,
        now + params.timeout_ms,
      ],
    );
  }
}

function isRetriableStatus(status: number): boolean {
  return status >= 500 || status === 429;
}
