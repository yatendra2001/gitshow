/**
 * Model pricing table — USD per 1M input/output tokens, plus optional
 * flat per-call surcharges (Gemini Search grounding fee, image-gen).
 *
 * Numbers are OpenRouter sticker prices as of 2026-04. They drift
 * over time — re-check at openrouter.ai/models when costs look off.
 *
 * Used by:
 *   - cloud/posthog.ts captureLlm — populates $ai_*_cost_usd
 *   - apps/worker observability/cost-aggregator.ts — per-scan totals
 */

export interface ModelPricing {
  /** USD per 1M input tokens. */
  inputUsdPerM: number;
  /** USD per 1M output tokens. */
  outputUsdPerM: number;
  /**
   * Flat per-call surcharge on top of token cost.
   *  - Gemini :online adds Google Search grounding ($35 / 1k queries)
   *  - Image gen models charge per image, not per token
   */
  perCallUsd?: number;
  /** Display name for dashboards (cleaner than the slug). */
  displayName: string;
  /** Logical role tag — useful for filtering "judge cost" vs "ranker cost". */
  category: "orchestrator" | "section" | "bulk" | "grounded" | "image" | "unknown";
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  "anthropic/claude-opus-4.7": {
    inputUsdPerM: 15,
    outputUsdPerM: 75,
    displayName: "Opus 4.7",
    category: "orchestrator",
  },
  "anthropic/claude-sonnet-4.6": {
    inputUsdPerM: 3,
    outputUsdPerM: 15,
    displayName: "Sonnet 4.6",
    category: "section",
  },
  "moonshotai/kimi-k2.6": {
    inputUsdPerM: 0.6,
    outputUsdPerM: 2.5,
    displayName: "Kimi K2.6",
    category: "bulk",
  },
  "google/gemini-3-flash-preview": {
    inputUsdPerM: 0.3,
    outputUsdPerM: 2.5,
    displayName: "Gemini 3 Flash Preview",
    category: "grounded",
  },
  "google/gemini-3-flash-preview:online": {
    inputUsdPerM: 0.3,
    outputUsdPerM: 2.5,
    // Google Search grounding: $35 / 1k requests per Google's pricing.
    // OpenRouter passes this through on the `:online` variant.
    perCallUsd: 0.035,
    displayName: "Gemini 3 Flash Preview (grounded)",
    category: "grounded",
  },
  "google/gemini-3-pro-image-preview": {
    // Banner generation. Approximate per-image price; tokens are
    // negligible for this model.
    inputUsdPerM: 0,
    outputUsdPerM: 0,
    perCallUsd: 0.04,
    displayName: "Gemini 3 Pro Image (banner gen)",
    category: "image",
  },
};

export interface CostBreakdown {
  inputUsd: number;
  outputUsd: number;
  perCallUsd: number;
  totalUsd: number;
}

export function costForCall(args: {
  model: string;
  inputTokens?: number;
  outputTokens?: number;
}): CostBreakdown {
  const pricing =
    MODEL_PRICING[args.model] ?? MODEL_PRICING[stripVariant(args.model)];
  if (!pricing) {
    return { inputUsd: 0, outputUsd: 0, perCallUsd: 0, totalUsd: 0 };
  }
  const inputUsd =
    ((args.inputTokens ?? 0) / 1_000_000) * pricing.inputUsdPerM;
  const outputUsd =
    ((args.outputTokens ?? 0) / 1_000_000) * pricing.outputUsdPerM;
  const perCallUsd = pricing.perCallUsd ?? 0;
  return {
    inputUsd,
    outputUsd,
    perCallUsd,
    totalUsd: inputUsd + outputUsd + perCallUsd,
  };
}

export function displayNameForModel(model: string): string {
  return (
    MODEL_PRICING[model]?.displayName ??
    MODEL_PRICING[stripVariant(model)]?.displayName ??
    model
  );
}

export function categoryForModel(model: string): ModelPricing["category"] {
  return (
    MODEL_PRICING[model]?.category ??
    MODEL_PRICING[stripVariant(model)]?.category ??
    "unknown"
  );
}

/**
 * For agent SDKs that only return a single combined token total
 * (no per-direction split), estimate input vs output.
 *
 * Default 70/30 input-output is a rough average for tool-use agent
 * traces — heavy system prompt + reasoning + tool I/O on the input
 * side, smaller structured output. Override per call when the SDK
 * surfaces real numbers.
 */
export function estimateTokenSplit(
  totalTokens: number | undefined,
  inputBias = 0.7,
): { input: number; output: number } {
  const total = totalTokens ?? 0;
  const input = Math.round(total * inputBias);
  return { input, output: Math.max(0, total - input) };
}

function stripVariant(model: string): string {
  return model.split(":")[0];
}
