/**
 * Gemini grounded client — google/gemini-3-flash-preview via OpenRouter.
 *
 * OpenRouter exposes Gemini's native Google Search grounding + URL
 * context via the `:online` model suffix. The model fetches and reads
 * any URLs we mention in the prompt, and can fall back to a Google
 * search when grounding URLs don't have the answer.
 *
 * Anti-hallucination contract: every prompt must instruct the model to
 * return the literal `NO_INFO_FOUND` sentinel when it can't find any
 * external information. Callers treat that as null. The client also
 * detects the sentinel and exposes `noInfoFound: true` on the result.
 *
 * Retry policy: up to 20 attempts with exponential backoff (5s → 60s
 * cap), total budget 10 minutes. Gemini transient failures (429, 5xx,
 * network) retry; auth + permanent client errors (4xx other than 429)
 * surface immediately.
 */

import { captureLlm } from "./posthog.js";

const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-3-flash-preview:online";
const NO_INFO_SENTINEL = "NO_INFO_FOUND";
const MAX_ATTEMPTS = 20;
const BACKOFF_INITIAL_MS = 5_000;
const BACKOFF_CAP_MS = 60_000;
const TOTAL_BUDGET_MS = 600_000;
const REQUEST_TIMEOUT_MS = 120_000;

export interface GroundedSource {
  url: string;
  title?: string;
}

export interface GroundedCallInput {
  systemPrompt: string;
  userPrompt: string;
  /**
   * URLs to ground on. They get appended to the user prompt with
   * an explicit instruction so Gemini's URL context tool fires.
   * Caller is responsible for de-duping.
   */
  urls?: string[];
  /** Override default model. */
  model?: string;
  /** Reasoning effort hint for the model. */
  effort?: "low" | "medium" | "high";
  /** Optional label for trace logging — defaults to "gemini-grounded". */
  label?: string;
}

export interface GroundedCallOutput {
  text: string;
  /** True when the model returned exactly the NO_INFO_FOUND sentinel. */
  noInfoFound: boolean;
  /** URL citations from Gemini's grounding metadata. */
  sources: GroundedSource[];
  /** Elapsed wall-clock for the (possibly-retried) call. */
  durationMs: number;
  /** Number of attempts before success (1 = no retries). */
  attempts: number;
  /** Token usage when the API returns it. */
  usage?: { input: number; output: number };
}

interface OpenRouterChoice {
  message?: {
    content?: string;
    annotations?: Array<{
      type?: string;
      url_citation?: { url?: string; title?: string };
    }>;
  };
}

interface OpenRouterResponse {
  choices?: OpenRouterChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  error?: { message?: string; code?: number };
}

class TerminalError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "GeminiTerminalError";
  }
}

/**
 * Single Gemini-grounded call with anti-hallucination guard, URL
 * context, and the user-mandated retry policy.
 *
 * Throws only on terminal errors (auth failure, malformed request).
 * Transient failures (429, 5xx, network, timeout) are retried until
 * either MAX_ATTEMPTS or TOTAL_BUDGET_MS is exhausted.
 */
export async function callGroundedGemini(
  input: GroundedCallInput,
): Promise<GroundedCallOutput> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new TerminalError("OPENROUTER_API_KEY missing — cannot call Gemini");
  }

  const model = input.model ?? DEFAULT_MODEL;
  const userPromptWithUrls = composePrompt(input.userPrompt, input.urls);
  const body = JSON.stringify({
    model,
    messages: [
      { role: "system", content: input.systemPrompt },
      { role: "user", content: userPromptWithUrls },
    ],
    ...(input.effort ? { reasoning: { effort: input.effort } } : {}),
  });

  const t0 = Date.now();
  let attempt = 0;
  let lastErr: unknown;

  while (attempt < MAX_ATTEMPTS && Date.now() - t0 < TOTAL_BUDGET_MS) {
    attempt += 1;
    try {
      const result = await singleCall({ body, apiKey });
      const out: GroundedCallOutput = {
        ...result,
        durationMs: Date.now() - t0,
        attempts: attempt,
      };
      captureLlm({
        provider: "openrouter:google",
        model,
        spanName: input.label ?? "gemini-grounded",
        input: [
          { role: "system", content: input.systemPrompt.slice(0, 4000) },
          { role: "user", content: userPromptWithUrls.slice(0, 6000) },
        ],
        output: [{ role: "assistant", content: out.text.slice(0, 4000) }],
        inputTokens: out.usage?.input,
        outputTokens: out.usage?.output,
        latencyMs: out.durationMs,
        isError: false,
        baseUrl: OPENROUTER_ENDPOINT,
      });
      return out;
    } catch (err) {
      lastErr = err;
      if (err instanceof TerminalError) {
        captureLlm({
          provider: "openrouter:google",
          model,
          spanName: input.label ?? "gemini-grounded",
          input: [
            { role: "system", content: input.systemPrompt.slice(0, 4000) },
            { role: "user", content: userPromptWithUrls.slice(0, 6000) },
          ],
          output: [],
          latencyMs: Date.now() - t0,
          isError: true,
          error: err.message,
          httpStatus: err.status,
          baseUrl: OPENROUTER_ENDPOINT,
        });
        throw err;
      }
      const remaining = TOTAL_BUDGET_MS - (Date.now() - t0);
      if (attempt >= MAX_ATTEMPTS || remaining <= 0) break;
      const backoff = Math.min(
        BACKOFF_CAP_MS,
        BACKOFF_INITIAL_MS * 2 ** Math.min(attempt - 1, 6),
      );
      const sleep = Math.min(backoff, Math.max(1_000, remaining - 500));
      await delay(sleep);
    }
  }

  const elapsed = Date.now() - t0;
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  captureLlm({
    provider: "openrouter:google",
    model,
    spanName: input.label ?? "gemini-grounded",
    input: [
      { role: "system", content: input.systemPrompt.slice(0, 4000) },
      { role: "user", content: userPromptWithUrls.slice(0, 6000) },
    ],
    output: [],
    latencyMs: elapsed,
    isError: true,
    error: `${attempt} attempts: ${msg.slice(0, 240)}`,
    baseUrl: OPENROUTER_ENDPOINT,
  });
  throw new Error(
    `Gemini grounded call failed after ${attempt} attempt(s) in ${elapsed}ms: ${msg}`,
  );
}

async function singleCall(args: {
  body: string;
  apiKey: string;
}): Promise<Omit<GroundedCallOutput, "durationMs" | "attempts">> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(OPENROUTER_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        "Content-Type": "application/json",
      },
      body: args.body,
      signal: ctrl.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      // 401 / 403 / 400 / 404 are terminal — retrying won't help.
      // 429 (rate limit) and 5xx are transient.
      if (res.status === 401 || res.status === 403 || res.status === 404) {
        throw new TerminalError(
          `OpenRouter ${res.status}: ${errText.slice(0, 200)}`,
          res.status,
        );
      }
      if (res.status === 400 && !looksTransient(errText)) {
        throw new TerminalError(
          `OpenRouter 400: ${errText.slice(0, 200)}`,
          400,
        );
      }
      throw new Error(`OpenRouter ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = (await res.json()) as OpenRouterResponse;
    if (data.error) {
      throw new Error(`OpenRouter error: ${data.error.message ?? "unknown"}`);
    }
    const choice = data.choices?.[0];
    const text = choice?.message?.content?.trim() ?? "";
    if (!text) {
      // Empty completions are rare but real — treat as transient.
      throw new Error("OpenRouter returned empty completion");
    }

    const sources: GroundedSource[] = [];
    for (const a of choice?.message?.annotations ?? []) {
      if (a.type === "url_citation" && a.url_citation?.url) {
        sources.push({
          url: a.url_citation.url,
          title: a.url_citation.title,
        });
      }
    }

    return {
      text,
      noInfoFound: text === NO_INFO_SENTINEL,
      sources: dedupeSources(sources),
      usage: data.usage
        ? {
            input: data.usage.prompt_tokens ?? 0,
            output: data.usage.completion_tokens ?? 0,
          }
        : undefined,
    };
  } finally {
    clearTimeout(timer);
  }
}

function composePrompt(prompt: string, urls?: string[]): string {
  const trimmed = prompt.trimEnd();
  const tail = [
    "",
    "Anti-hallucination contract:",
    `If you cannot find any external information that meets the brief above,`,
    `respond with EXACTLY this single token and nothing else: ${NO_INFO_SENTINEL}`,
    `Do not invent details. Do not paraphrase missing-info into prose.`,
    `Stick to facts grounded in the URLs you read or the search results you fetched.`,
  ].join("\n");

  if (!urls || urls.length === 0) {
    return `${trimmed}\n${tail}`;
  }
  const urlBlock = [
    "",
    "Required reading — read these URLs first via your URL context tool:",
    ...urls.map((u) => `- ${u}`),
    "",
    "Stay strictly within the topic of these URLs. Do not wander to",
    "unrelated content even if your search surfaces it.",
  ].join("\n");
  return `${trimmed}\n${urlBlock}\n${tail}`;
}

function dedupeSources(sources: GroundedSource[]): GroundedSource[] {
  const seen = new Set<string>();
  const out: GroundedSource[] = [];
  for (const s of sources) {
    if (seen.has(s.url)) continue;
    seen.add(s.url);
    out.push(s);
  }
  return out;
}

function looksTransient(body: string): boolean {
  return /rate.?limit|temporar|server/i.test(body);
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
