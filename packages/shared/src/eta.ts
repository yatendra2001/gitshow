/**
 * Phase-duration medians used for ETA estimation on the live scan view.
 *
 * Seeded from session-4 production runs (apps/worker/profiles/yatendra2001/)
 * and the three cloud scans that completed end-to-end. Updated by a cron
 * script that rolls up `scan_events.duration_ms` per phase.
 */
import { PIPELINE_PHASES, type PipelinePhase } from "./events";

/**
 * Median wall-clock ms per phase, conservative. Safe to tweak — this is
 * only used for the ETA countdown, not the pipeline itself.
 */
export const PHASE_MEDIAN_MS: Record<PipelinePhase, number> = {
  "github-fetch": 12_000,
  "repo-filter": 1_000,
  inventory: 7 * 60_000,
  normalize: 6_000,
  discover: 45_000,
  workers: 9 * 60_000,
  hook: 90_000,
  numbers: 40_000,
  disclosure: 30_000,
  shipped: 35_000,
  assemble: 20_000,
  critic: 45_000,
  bind: 3_000,
};

/** Total conservative median in ms (~ 20 min). */
export const TOTAL_MEDIAN_MS: number = Object.values(PHASE_MEDIAN_MS).reduce(
  (a, b) => a + b,
  0,
);

/**
 * Given the sequence of completed phases and the current (in-progress)
 * phase, return the expected remaining ms.
 */
export function estimateRemainingMs(
  lastCompleted: PipelinePhase | null,
  currentPhase: PipelinePhase | null,
): number {
  if (!currentPhase && !lastCompleted) return TOTAL_MEDIAN_MS;
  const startFromIndex = currentPhase
    ? PIPELINE_PHASES.indexOf(currentPhase)
    : (lastCompleted ? PIPELINE_PHASES.indexOf(lastCompleted) : -1) + 1;
  if (startFromIndex < 0) return TOTAL_MEDIAN_MS;
  let sum = 0;
  for (let i = startFromIndex; i < PIPELINE_PHASES.length; i++) {
    sum += PHASE_MEDIAN_MS[PIPELINE_PHASES[i]];
  }
  return sum;
}

/** Short "3m 47s" formatter for timers. */
export function formatDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem ? `${m}m ${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${h}h ${mm}m` : `${h}h`;
}

/** Percentage 0–100 of the whole pipeline that's done, for the progress bar. */
export function progressPercent(
  lastCompleted: PipelinePhase | null,
  currentPhase: PipelinePhase | null,
): number {
  const remaining = estimateRemainingMs(lastCompleted, currentPhase);
  const total = TOTAL_MEDIAN_MS;
  return Math.max(0, Math.min(100, Math.round(((total - remaining) / total) * 100)));
}
