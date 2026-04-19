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
      kind:
        | "stage-start"
        | "stage-end"
        | "stage-warn"
        | "worker-update"
        | "error"
        | "reasoning"
        | "test-result"
        | "eval-axes"
        | "usage"
        | "plan";
      stage?: string | null;
      worker?: string | null;
      status?: string | null;
      duration_ms?: number | null;
      message?: string | null;
      data_json?: unknown | null;
    },
  ): Promise<void> {
    await this.query(
      `INSERT INTO scan_events
         (scan_id, kind, stage, worker, status, duration_ms, message, data_json, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        scanId,
        ev.kind,
        ev.stage ?? null,
        ev.worker ?? null,
        ev.status ?? null,
        ev.duration_ms ?? null,
        ev.message ?? null,
        ev.data_json == null ? null : JSON.stringify(ev.data_json),
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
}

function isRetriableStatus(status: number): boolean {
  return status >= 500 || status === 429;
}
