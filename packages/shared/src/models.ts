/**
 * Multi-model routing for the resume pipeline.
 *
 * Three roles with different cost/quality/reliability tradeoffs:
 *   - orchestrator: global reasoning — discover, person, research planner,
 *     evaluator. Expensive, rare. Use the strongest model.
 *   - section: per-section semantic agents — work, education, projects,
 *     skills. Need reliable tool-calling; sonnet is the proven baseline.
 *   - bulk: text-heavy digest tasks — README parse, blog import,
 *     build-log one-liners, Google-result scraping. Cheap per-token wins.
 *
 * Flip the values here — every call site resolves via `modelForRole()`.
 * DEFAULT_SCAN_MODEL stays around so code that doesn't yet declare a
 * role keeps working; it mirrors the bulk tier.
 */
export const MODEL_BY_ROLE = {
  orchestrator: "anthropic/claude-opus-4.7",
  section: "anthropic/claude-sonnet-4.6",
  bulk: "moonshotai/kimi-k2.6",
} as const;

export type ModelRole = keyof typeof MODEL_BY_ROLE;

export function modelForRole(role: ModelRole): string {
  return MODEL_BY_ROLE[role];
}

/**
 * Legacy single-model default — kept so callers that don't yet declare
 * a role (CLI dev runs, one-off scripts) still resolve a model.
 * Mirrors the bulk tier (cheapest), since that's the safest default for
 * ad-hoc usage where cost matters more than quality.
 */
export const DEFAULT_SCAN_MODEL = MODEL_BY_ROLE.bulk;
