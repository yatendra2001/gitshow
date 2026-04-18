/**
 * Minimal Cloudflare D1 HTTP client for the worker.
 *
 * The worker doesn't have a Workers binding to D1 — it's running on Fly —
 * so it hits D1 via the Cloudflare REST API. Every scan does ~50-100 writes
 * (stage events + heartbeats + claim upserts), which is well under D1's
 * per-account rate limits.
 */

export interface D1Config {
  accountId: string;
  databaseId: string;
  apiToken: string;
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

export class D1Client {
  private endpoint: string;
  private apiToken: string;

  constructor(cfg: D1Config) {
    this.endpoint = `https://api.cloudflare.com/client/v4/accounts/${cfg.accountId}/d1/database/${cfg.databaseId}/query`;
    this.apiToken = cfg.apiToken;
  }

  static fromEnv(): D1Client {
    const accountId = requireEnv("CF_ACCOUNT_ID");
    const databaseId = requireEnv("D1_DATABASE_ID");
    const apiToken = requireEnv("CF_API_TOKEN");
    return new D1Client({ accountId, databaseId, apiToken });
  }

  async query(sql: string, params: D1Param[] = []): Promise<D1QueryResponse> {
    const resp = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql, params }),
    });
    const json = (await resp.json()) as D1QueryResponse;
    if (!resp.ok || !json.success) {
      const err = json.errors?.[0]?.message ?? `d1 query failed (${resp.status})`;
      throw new Error(`d1: ${err}`);
    }
    return json;
  }

  // ── Scan state ────────────────────────────────────────────

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

  // ── Event log (append-only) ───────────────────────────────

  async insertEvent(
    scanId: string,
    ev: {
      kind: "stage-start" | "stage-end" | "stage-warn" | "worker-update" | "error";
      stage?: string | null;
      worker?: string | null;
      status?: string | null;
      duration_ms?: number | null;
      message?: string | null;
    },
  ): Promise<void> {
    await this.query(
      `INSERT INTO scan_events
         (scan_id, kind, stage, worker, status, duration_ms, message, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        scanId,
        ev.kind,
        ev.stage ?? null,
        ev.worker ?? null,
        ev.status ?? null,
        ev.duration_ms ?? null,
        ev.message ?? null,
        Date.now(),
      ],
    );
  }

  // ── Claims ────────────────────────────────────────────────

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

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    throw new Error(`missing required env var: ${name}`);
  }
  return v;
}
