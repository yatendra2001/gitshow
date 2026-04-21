/**
 * PhaseReporter — wraps pipeline stages with D1-backed progress events.
 *
 * The resume pipeline runs for many minutes. Without a reporter the user
 * sees "Getting set up" for the entire duration and 0 events in the log,
 * which makes a working scan indistinguishable from a stuck one.
 *
 * Two levels of phases:
 *   - `phase(name, fn)` — sequential stages. Updates `scans.current_phase`
 *     so the progress page headline advances, and writes `stage-start` /
 *     `stage-end` events to the log.
 *   - `subPhase(name, fn)` — concurrent sub-agents within a phase.
 *     Writes events only; does NOT touch `current_phase` (which would
 *     flicker as parallel agents finish out-of-order).
 *
 * In dev / local runs we fall back to `noopPhases`, which is a no-op.
 */

import type { D1Client } from "../cloud/d1.js";

export interface PhaseReporter {
  phase<T>(name: string, fn: () => Promise<T>): Promise<T>;
  subPhase<T>(name: string, fn: () => Promise<T>): Promise<T>;
}

export const noopPhases: PhaseReporter = {
  phase: async (_n, fn) => fn(),
  subPhase: async (_n, fn) => fn(),
};

export function createD1Phases(d1: D1Client, scanId: string): PhaseReporter {
  const starts = new Map<string, number>();

  const safe = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch {
      // Never let a progress-tracking write kill the pipeline.
    }
  };

  return {
    async phase(name, fn) {
      starts.set(name, Date.now());
      await safe(
        Promise.all([
          d1.updateScanStatus(scanId, { current_phase: name }),
          d1.insertEvent(scanId, { kind: "stage-start", stage: name }),
        ]),
      );
      try {
        const out = await fn();
        const duration = Date.now() - (starts.get(name) ?? Date.now());
        starts.delete(name);
        await safe(
          Promise.all([
            d1.updateScanStatus(scanId, { last_completed_phase: name }),
            d1.insertEvent(scanId, {
              kind: "stage-end",
              stage: name,
              duration_ms: duration,
            }),
          ]),
        );
        return out;
      } catch (err) {
        starts.delete(name);
        await safe(
          d1.insertEvent(scanId, {
            kind: "error",
            stage: name,
            message:
              err instanceof Error
                ? err.message.slice(0, 500)
                : String(err).slice(0, 500),
          }),
        );
        throw err;
      }
    },

    async subPhase(name, fn) {
      starts.set(name, Date.now());
      await safe(
        d1.insertEvent(scanId, { kind: "stage-start", stage: name }),
      );
      try {
        const out = await fn();
        const duration = Date.now() - (starts.get(name) ?? Date.now());
        starts.delete(name);
        await safe(
          d1.insertEvent(scanId, {
            kind: "stage-end",
            stage: name,
            duration_ms: duration,
          }),
        );
        return out;
      } catch (err) {
        starts.delete(name);
        await safe(
          d1.insertEvent(scanId, {
            kind: "error",
            stage: name,
            message:
              err instanceof Error
                ? err.message.slice(0, 500)
                : String(err).slice(0, 500),
          }),
        );
        throw err;
      }
    },
  };
}
