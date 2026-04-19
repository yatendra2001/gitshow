/**
 * Publishes pipeline events from the Fly worker to the ScanLiveDO for
 * realtime fan-out to WebSocket-connected browsers.
 *
 * Dual-sink pattern:
 *   1. D1 insertEvent (durable, persistent — source of truth)
 *   2. doClient.publish (ephemeral, realtime — fire-and-forget)
 *
 * The publish is fire-and-forget: a failure here must NEVER fail a scan.
 * Reconnecting clients backfill from D1, so losing a DO publish only
 * delays the live update by 1s (D1 poll fallback in the web client).
 */
import { requireEnv, consoleLogger, type Logger } from "../util";
import type { PipelineEvent } from "../events";

export interface DOClientConfig {
  /** Publish endpoint of the realtime worker, e.g. https://gitshow-realtime.<acct>.workers.dev */
  endpoint: string;
  /** Shared secret set as `X-Gitshow-Pipeline-Secret`. */
  secret: string;
  logger?: Logger;
  /** Milliseconds before we abandon the publish attempt. Default 1500. */
  timeoutMs?: number;
}

export class DOPublishClient {
  private endpoint: string;
  private secret: string;
  private log: Logger;
  private timeoutMs: number;

  constructor(cfg: DOClientConfig) {
    this.endpoint = cfg.endpoint.replace(/\/+$/, "");
    this.secret = cfg.secret;
    this.log = (cfg.logger ?? consoleLogger).child({ src: "do-client" });
    this.timeoutMs = cfg.timeoutMs ?? 1500;
  }

  static fromEnv(opts?: { logger?: Logger }): DOPublishClient | null {
    const endpoint =
      (globalThis as { process?: { env?: Record<string, string | undefined> } })
        .process?.env?.REALTIME_ENDPOINT;
    if (!endpoint) return null;
    const secret = requireEnv("PIPELINE_SHARED_SECRET");
    return new DOPublishClient({ endpoint, secret, logger: opts?.logger });
  }

  /**
   * Fire-and-forget publish. Caller should NOT await if a broken realtime
   * path must not block the pipeline; the internal timeout ensures it
   * won't hang forever.
   */
  async publish(scanId: string, event: PipelineEvent): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const resp = await fetch(
        `${this.endpoint}/scans/${encodeURIComponent(scanId)}/events`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Gitshow-Pipeline-Secret": this.secret,
          },
          body: JSON.stringify(event),
          signal: controller.signal,
        },
      );
      if (!resp.ok) {
        const body = await resp.text();
        this.log.warn?.(
          { scan_id: scanId, status: resp.status, body: body.slice(0, 200), kind: event.kind },
          "do.publish.bad-status",
        );
      }
    } catch (err) {
      this.log.warn?.(
        {
          scan_id: scanId,
          err: err instanceof Error ? err.message : String(err),
          kind: event.kind,
        },
        "do.publish.failed",
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
