/**
 * Gemini-grounded fallback for unknown DNS providers.
 *
 * Uses OpenRouter's `:online` model suffix to activate Gemini's
 * native Google Search grounding — same pattern the worker pipeline
 * uses (see `packages/shared/src/cloud/gemini-grounded.ts`). No
 * Tavily, no manual retrieval step: Gemini fetches what it needs and
 * returns URL citations in the response's `annotations`.
 *
 * Why a separate file vs reusing `callGroundedGemini`: the shared
 * helper reads `process.env.OPENROUTER_API_KEY` (Node-style), which
 * is fine in the worker but inconsistent with how OpenNext-on-Workers
 * exposes secrets here (via the request-scoped CloudflareEnv binding).
 * This file mirrors the same prompt + response shape but reads from
 * the bound env directly. The contract — JSON schema, sentinel,
 * citations — stays identical.
 *
 * Cost: a single OpenRouter call per uncached lookup. Gemini's online
 * variant is billed per search query in addition to tokens; figure
 * ~$0.005-0.02 per call. Cached for 30 days keyed by
 * (provider, instruction_kind) so a popular registrar burns the
 * budget once, not once per user.
 *
 * Output safety: strict JSON schema in the prompt, parsed defensively,
 * every step rendered as plain text (no HTML, no markdown, no
 * backticks). Citations are rendered separately with rel="noopener".
 */

import type { D1Database } from "@cloudflare/workers-types";
import type { InstructionSet } from "./providers";

// CloudflareEnv is a global interface declared in cloudflare-env.d.ts.

const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview:online";

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ─── Cache layer ───────────────────────────────────────────────────────

interface CachedSteps {
  cacheKey: string;
  provider: string;
  instructionKind: string;
  steps: InstructionSet["steps"];
  citations: string[];
  generatedAt: number;
  model: string;
  ageDays: number;
}

async function cacheKey(provider: string, kind: string): Promise<string> {
  const data = new TextEncoder().encode(`${provider}::${kind}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function readCached(
  db: D1Database,
  provider: string,
  kind: string,
): Promise<CachedSteps | null> {
  const key = await cacheKey(provider, kind);
  const row = await db
    .prepare(
      `SELECT cache_key, provider, instruction_kind, steps_json, expires_at, created_at
         FROM provider_steps_cache
        WHERE cache_key = ? AND expires_at > ?`,
    )
    .bind(key, Date.now())
    .first<{
      cache_key: string;
      provider: string;
      instruction_kind: string;
      steps_json: string;
      expires_at: number;
      created_at: number;
    }>();
  if (!row) return null;
  void db
    .prepare(`UPDATE provider_steps_cache SET hits = hits + 1 WHERE cache_key = ?`)
    .bind(key)
    .run()
    .catch(() => null);
  let parsed: { steps: InstructionSet["steps"]; citations: string[]; model: string; generated_at: number };
  try {
    parsed = JSON.parse(row.steps_json);
  } catch {
    return null;
  }
  return {
    cacheKey: row.cache_key,
    provider: row.provider,
    instructionKind: row.instruction_kind,
    steps: parsed.steps,
    citations: parsed.citations,
    generatedAt: parsed.generated_at,
    model: parsed.model,
    ageDays: Math.floor((Date.now() - row.created_at) / (24 * 60 * 60 * 1000)),
  };
}

async function writeCached(
  db: D1Database,
  provider: string,
  kind: string,
  steps: InstructionSet["steps"],
  citations: string[],
  model: string,
): Promise<void> {
  const key = await cacheKey(provider, kind);
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO provider_steps_cache
         (cache_key, provider, instruction_kind, steps_json, hits, helpful_count, unhelpful_count, expires_at, created_at)
         VALUES (?, ?, ?, ?, 0, 0, 0, ?, ?)
         ON CONFLICT(cache_key) DO UPDATE SET
           steps_json = excluded.steps_json,
           expires_at = excluded.expires_at,
           created_at = excluded.created_at,
           hits = 0, helpful_count = 0, unhelpful_count = 0`,
    )
    .bind(
      key,
      provider,
      kind,
      JSON.stringify({ steps, citations, model, generated_at: now }),
      now + CACHE_TTL_MS,
      now,
    )
    .run();
}

export async function recordFeedback(
  db: D1Database,
  provider: string,
  kind: string,
  helpful: boolean,
): Promise<void> {
  const key = await cacheKey(provider, kind);
  const col = helpful ? "helpful_count" : "unhelpful_count";
  await db
    .prepare(`UPDATE provider_steps_cache SET ${col} = ${col} + 1 WHERE cache_key = ?`)
    .bind(key)
    .run();
}

// ─── Gemini call ───────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a DNS-setup-instructions writer for the SaaS "gitshow".
You produce concise, accurate, step-by-step instructions for adding a CNAME
or TXT record in a specific DNS provider's UI.

CRITICAL RULES:
- Output MUST be valid JSON matching the schema given.
- Steps must be plain prose, no markdown, no bullet markers, no HTML.
- Each step describes ONE concrete action ("Click X" / "Open Y").
- Use the provider's exact UI labels and menu paths, current as of today.
- If you don't have enough source material to answer accurately, return
  steps: [] and a single citation explaining the gap.
- Maximum 7 steps. No marketing fluff. No "you may need to wait" warnings.
- Do not invent menu paths. If you're unsure, say so in plain prose.`.trim();

const RESPONSE_SCHEMA_PROMPT = `Return ONLY a JSON object of shape:
{
  "steps": [
    { "text": "<short imperative sentence>", "copyValue": "<optional code value to render with a copy button>" }
  ],
  "citations": ["<source url 1>", "<source url 2>"]
}
No markdown. No prose around the JSON. Maximum 7 steps. copyValue is OPTIONAL.`;

interface GeminiResponse {
  steps: Array<{ text: string; copyValue?: string }>;
  citations: string[];
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
  error?: { message?: string; code?: number };
}

export interface GenerateInput {
  providerLabel: string;
  recordType: "CNAME" | "TXT";
  recordName: string;
  recordValue: string;
  hostname: string;
}

export interface GenerateOutput {
  steps: InstructionSet["steps"];
  citations: string[];
  fromCache: boolean;
  cacheAgeDays?: number;
  model: string;
}

export async function generateProviderInstructions(
  env: CloudflareEnv,
  db: D1Database,
  input: GenerateInput & { instructionKind: InstructionSet["kind"] },
): Promise<GenerateOutput | null> {
  // Cache hit?
  const cached = await readCached(db, input.providerLabel, input.instructionKind);
  if (cached) {
    return {
      steps: cached.steps,
      citations: cached.citations,
      fromCache: true,
      cacheAgeDays: cached.ageDays,
      model: cached.model,
    };
  }

  if (!env.OPENROUTER_API_KEY) return null;

  // Prompt-injection-safe: providerLabel is sanitized in the API layer
  // (alphanumeric + dash + space, ≤50 chars). recordName/recordValue
  // are derived from validated hostname + our own constants, never raw
  // user input.
  const userMessage = [
    `Provider: ${input.providerLabel}`,
    `Record type: ${input.recordType}`,
    `Record name to enter: ${input.recordName}`,
    `Record value to enter: ${input.recordValue}`,
    `Hostname being set up: ${input.hostname}`,
    "",
    `Search ${input.providerLabel}'s docs and help center for the current UI`,
    `path to add a ${input.recordType} record. Cite the URLs you used.`,
    "",
    RESPONSE_SCHEMA_PROMPT,
  ].join("\n");

  let raw: string;
  let citations: string[] = [];
  try {
    const res = await fetch(OPENROUTER_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "content-type": "application/json",
        "x-title": "gitshow",
        "http-referer": "https://gitshow.io",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
        max_tokens: 800,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as OpenRouterResponse;
    if (json.error) return null;
    const choice = json.choices?.[0];
    raw = choice?.message?.content ?? "";
    // Pull URL citations out of Gemini's grounding metadata. Same shape
    // we use in the worker's `callGroundedGemini`.
    for (const a of choice?.message?.annotations ?? []) {
      if (a.type === "url_citation" && a.url_citation?.url) {
        citations.push(a.url_citation.url);
      }
    }
  } catch {
    return null;
  }

  const parsed = parseGeminiOutput(raw);
  if (!parsed || parsed.steps.length === 0) return null;

  // Sanitize: every step.text becomes plain text, ≤200 chars; copyValue
  // ≤200 chars; citations must be valid http(s) URLs. Prefer Gemini's
  // grounding metadata over the model's `citations` field; combine both
  // and de-dupe.
  const safe: InstructionSet["steps"] = parsed.steps.slice(0, 7).map((s) => ({
    text: stripUnsafe(s.text).slice(0, 200),
    copyValue: s.copyValue ? stripUnsafe(s.copyValue).slice(0, 200) : undefined,
  }));
  const merged = [...citations, ...parsed.citations];
  const safeCitations = dedupe(
    merged.filter((c) => /^https?:\/\//.test(c)),
  ).slice(0, 5);

  await writeCached(db, input.providerLabel, input.instructionKind, safe, safeCitations, MODEL);

  return {
    steps: safe,
    citations: safeCitations,
    fromCache: false,
    model: MODEL,
  };
}

function parseGeminiOutput(raw: string): GeminiResponse | null {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const obj = JSON.parse(jsonMatch[0]) as Partial<GeminiResponse>;
    if (!Array.isArray(obj.steps)) return null;
    if (!Array.isArray(obj.citations)) obj.citations = [];
    return obj as GeminiResponse;
  } catch {
    return null;
  }
}

/**
 * Strip control bytes / HTML / backticks / left-to-right marks. Used
 * before rendering Gemini-produced strings so prompt injection that
 * tries to embed control sequences gets neutralized.
 */
function stripUnsafe(s: string): string {
  // Built via String.fromCharCode to avoid a literal control char in
  // source (so no-control-regex lints don't scream).
  const ctrl = new RegExp(
    `[${String.fromCharCode(0)}-${String.fromCharCode(0x1f)}${String.fromCharCode(0x7f)}]`,
    "g",
  );
  const ltr = /[​-‏‪-‮⁦-⁩]/g;
  return String(s ?? "")
    .replace(ctrl, "")
    .replace(ltr, "")
    .replace(/<[^>]+>/g, "")
    .replace(/`/g, "")
    .trim();
}

function dedupe<T>(xs: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const x of xs) {
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}
