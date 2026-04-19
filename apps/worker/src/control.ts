/**
 * Control-plane polling for scans.
 *
 * Workers poll D1 `scan_controls` every 2s. When they see an
 * unacked `stop` row they:
 *   1. flip `stopRequested` to true (callers check between stages)
 *   2. emit a `control-ack` event so the UI can update
 *   3. mark the control row acked so a restart doesn't re-trigger it
 *
 * Browser-side polling is gone (see use-scan-stream.ts), but
 * server-to-server polling is cheap — tiny query, every 2s.
 */

import type { PipelineEvent } from "@gitshow/shared/events";
import type { D1Client } from "./cloud/d1.js";
import type { Logger } from "@gitshow/shared/util";

export interface ControlPollerConfig {
  d1: D1Client;
  scanId: string;
  messageId?: string;
  emit: (ev: PipelineEvent) => void;
  log?: Logger;
  intervalMs?: number;
}

export class ControlPoller {
  private d1: D1Client;
  private scanId: string;
  private messageId?: string;
  private emit: (ev: PipelineEvent) => void;
  private log?: Logger;
  private intervalMs: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private _stopRequested = false;

  constructor(cfg: ControlPollerConfig) {
    this.d1 = cfg.d1;
    this.scanId = cfg.scanId;
    this.messageId = cfg.messageId;
    this.emit = cfg.emit;
    this.log = cfg.log;
    this.intervalMs = cfg.intervalMs ?? 2000;
  }

  get stopRequested(): boolean {
    return this._stopRequested;
  }

  start(): void {
    if (this.timer) return;
    this.scheduleNextTick();
  }

  dispose(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNextTick(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.tick();
    }, this.intervalMs);
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    try {
      const pending = await this.d1.getPendingControls(this.scanId);
      for (const ctl of pending) {
        if (ctl.action === "stop") {
          if (!this._stopRequested) {
            this._stopRequested = true;
            this.emit({
              kind: "control-ack",
              action: "stop",
              note: "stop requested by user; finishing current stage",
              ...(this.messageId ? { message_id: this.messageId } : {}),
            });
          }
        }
        // Best-effort ack so the control doesn't re-fire on restart.
        try {
          await this.d1.ackControl(ctl.id);
        } catch (err) {
          this.log?.warn?.(
            { err: err instanceof Error ? err.message : String(err) },
            "control.ack.failed",
          );
        }
      }
    } catch (err) {
      this.log?.warn?.(
        { err: err instanceof Error ? err.message : String(err) },
        "control.poll.failed",
      );
    } finally {
      this.scheduleNextTick();
    }
  }
}

/**
 * Thrown when a scan is asked to stop. Pipeline catches this and
 * marks the scan cancelled instead of failed.
 */
export class ScanStoppedError extends Error {
  constructor(message = "scan stopped by user") {
    super(message);
    this.name = "ScanStoppedError";
  }
}
