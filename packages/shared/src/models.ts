/**
 * Single source of truth for the default model used by every
 * user-facing scan + intake run. Web API routes read this when a
 * request doesn't pin a model; the worker reads it as the fallback
 * when `MODEL` env var isn't set.
 *
 * Change it here — all call sites pick it up.
 */
export const DEFAULT_SCAN_MODEL = "moonshotai/kimi-k2.6";
