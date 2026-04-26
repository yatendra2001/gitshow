/**
 * TinyFish Agent client — agent.tinyfish.ai automation runs.
 *
 * Different from the Search/Fetch APIs (cloud/tinyfish.ts):
 *   - Search/Fetch: stateless single-page fetches and SERPs.
 *   - Agent:        ↺ Goal-driven browsing — TinyFish runs a real
 *                     browser and follows the goal until the result
 *                     is satisfied. Slow (30-120s) but powerful for
 *                     login-walled / JS-heavy targets like LinkedIn.
 *
 * We use the synchronous /run endpoint — request blocks until the
 * agent finishes. The user accepted the latency tradeoff in exchange
 * for the structural simplicity of not having to poll an async job.
 *
 * Same TINYFISH_API_KEY auths both products.
 */

const DEFAULT_ENDPOINT = "https://agent.tinyfish.ai/v1/automation/run";
const DEFAULT_TIMEOUT_MS = 180_000;

export interface AgentRunOptions {
  /** The page (or starting URL) the agent operates on. */
  url: string;
  /**
   * Natural-language instruction. Be explicit about scope: the agent
   * will follow links unless told to stay put. Always include
   * "Stay on this URL only" for single-page targets.
   */
  goal: string;
  /** Override request timeout (default 180s). */
  timeoutMs?: number;
  /** Override endpoint (for staging / dev). */
  endpoint?: string;
}

export interface AgentRunResult {
  ok: boolean;
  /**
   * Final extracted payload from the agent. Shape is goal-dependent —
   * for LinkedIn extraction we ask for structured JSON, for free-form
   * scrapes we get markdown.
   */
  result?: unknown;
  /** Whatever the agent calls "status" — usually "COMPLETED" / "FAILED". */
  status?: string;
  /** Run identifier so we can reference it in trace / TinyFish dashboard. */
  runId?: string;
  /** Surfaced when ok=false. */
  error?: string;
}

export class TinyFishAgentClient {
  private apiKey: string;
  private endpoint: string;

  constructor(cfg: { apiKey: string; endpoint?: string }) {
    this.apiKey = cfg.apiKey;
    this.endpoint = cfg.endpoint ?? DEFAULT_ENDPOINT;
  }

  /** Returns null if TINYFISH_API_KEY isn't set. */
  static fromEnv(): TinyFishAgentClient | null {
    const apiKey = process.env.TINYFISH_API_KEY;
    if (!apiKey) return null;
    return new TinyFishAgentClient({ apiKey });
  }

  async run(opts: AgentRunOptions): Promise<AgentRunResult> {
    const ctrl = new AbortController();
    const timer = setTimeout(
      () => ctrl.abort(),
      opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    try {
      const res = await fetch(opts.endpoint ?? this.endpoint, {
        method: "POST",
        headers: {
          "X-API-Key": this.apiKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ url: opts.url, goal: opts.goal }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return {
          ok: false,
          error: `tinyfish agent http ${res.status}: ${body.slice(0, 240)}`,
        };
      }
      const data = (await res.json()) as {
        run_id?: string;
        status?: string;
        result?: unknown;
        error?: string;
      };
      const status = data.status ?? "UNKNOWN";
      const isSuccess = /COMPLET/i.test(status) || data.result !== undefined;
      return {
        ok: isSuccess,
        result: data.result,
        status,
        runId: data.run_id,
        error: isSuccess ? undefined : (data.error ?? `agent status: ${status}`),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    } finally {
      clearTimeout(timer);
    }
  }
}
