/**
 * Build-in-public engine — voice calibration + draft generation.
 *
 * Two responsibilities:
 *
 *   1. extractVoiceProfile()
 *      Takes 2-5 writing samples the user has pasted, returns a
 *      structured voice profile (tone, sentence length, emoji freq,
 *      recurring hooks, vocab tells, things-to-avoid). Stored in
 *      bip_voice_profiles.profile_json so every draft prompt can
 *      include it.
 *
 *   2. generateDrafts()
 *      Takes a bip_event (shipped thing) + the voice profile + 1-2 raw
 *      samples and produces drafts for the user's enabled platforms
 *      (x_thread, linkedin, blog). Returns a single JSON blob the
 *      route persists into bip_drafts.content_json.
 *
 * Model: anthropic/claude-sonnet-4.6 via OpenRouter — same gateway as
 * the resume pipeline. Sonnet is the right tier for voice-matched
 * short-to-medium-form prose. Opus is reserved for the long-form
 * case-study generator (next PR).
 *
 * We deliberately do NOT generate engagement-bait artifacts: no
 * "thread 🧵" emoji headers, no LinkedIn humble-brag scaffolds. The
 * system prompt forbids those patterns explicitly.
 */

export interface BipAiContext {
  apiKey: string;
  appUrl: string;
}

// ──────────────────────────────────────────────────────────────
// Constants — model + endpoint
// ──────────────────────────────────────────────────────────────

const SONNET_MODEL = "anthropic/claude-sonnet-4.6";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export const BIP_DRAFT_MODEL = SONNET_MODEL;

// ──────────────────────────────────────────────────────────────
// Voice profile
// ──────────────────────────────────────────────────────────────

export interface VoiceProfile {
  schemaVersion: 1;
  /** 1-line description: "casual, direct, slight self-deprecation". */
  tone: string;
  sentenceLength: "short" | "medium" | "long" | "mixed";
  emojiFrequency: "none" | "rare" | "occasional" | "frequent";
  /** Common emojis. Empty if frequency is "none". */
  emojis: string[];
  /** Recurring opener patterns the user uses. */
  hooks: string[];
  /** Signature words or phrases that mark this voice. */
  vocabularyTells: string[];
  /** Patterns the user *doesn't* do — drives negative prompting. */
  avoid: string[];
  /** One short example sentence that opens like the user would. */
  exampleOpening: string;
  generatedAt: string;
}

const VOICE_SYSTEM_PROMPT = `You are a voice profiler. Read 2-5 writing samples from a developer (tweets, LinkedIn posts, blog excerpts, Slack messages) and extract a structured voice profile a downstream model can use to mimic them.

Rules:
- Be specific. "casual, direct" is fine; "professional and engaging" is useless.
- For hooks: capture how this person *actually starts* posts. Examples: "Shipped X.", "Three things I learned…", "the thing nobody tells you about Y", "spent the weekend rebuilding…". Pull from the samples — don't invent.
- For vocabularyTells: signature words/phrases. Lowercase preferences. Em-dash usage. Profanity. Specific jargon. "ship/shipped" frequency. Things that make this voice identifiable in one sentence.
- For avoid: what this voice *doesn't* do. Examples: "no rocket emojis", "no 'I'm excited to announce'", "no bullet lists", "no engagement-bait questions at the end", "never says 'thoughts?'".
- exampleOpening must be 6-14 words, in the user's voice. Write a plausible opening that doesn't reference any actual sample — generic enough to be a template, specific enough to feel like them.

Return strict JSON, no prose, no markdown fences:

{
  "tone": "string — 1-line",
  "sentenceLength": "short | medium | long | mixed",
  "emojiFrequency": "none | rare | occasional | frequent",
  "emojis": ["🔥","..."],
  "hooks": ["string", "string", "string"],
  "vocabularyTells": ["string", "string"],
  "avoid": ["string", "string"],
  "exampleOpening": "string"
}`;

interface VoiceSampleInput {
  kind: string;
  body: string;
}

/**
 * Extract a voice profile from raw samples. Returns a validated
 * VoiceProfile or throws. Caller is responsible for persistence.
 */
export async function extractVoiceProfile(
  samples: VoiceSampleInput[],
  ctx: BipAiContext,
): Promise<VoiceProfile> {
  if (samples.length === 0) {
    throw new Error("voice_no_samples");
  }

  const compactSamples = samples
    .slice(0, 6)
    .map((s, i) => {
      const trimmed = s.body.slice(0, 2000);
      return `Sample ${i + 1} (${s.kind}):\n"""\n${trimmed}\n"""`;
    })
    .join("\n\n");

  const userPrompt = `Extract this developer's voice profile from these samples. Return JSON only.\n\n${compactSamples}`;
  const raw = await callOpenRouter(
    ctx.apiKey,
    ctx.appUrl,
    VOICE_SYSTEM_PROMPT,
    userPrompt,
    0.3,
  );
  const json = JSON.parse(unwrapJson(raw)) as Partial<VoiceProfile>;
  return coerceVoiceProfile(json);
}

function coerceVoiceProfile(raw: Partial<VoiceProfile>): VoiceProfile {
  const allowedLen = ["short", "medium", "long", "mixed"] as const;
  const allowedFreq = ["none", "rare", "occasional", "frequent"] as const;
  return {
    schemaVersion: 1 as const,
    tone: typeof raw.tone === "string" ? raw.tone.trim() : "neutral, professional",
    sentenceLength: (allowedLen as readonly string[]).includes(
      raw.sentenceLength as string,
    )
      ? (raw.sentenceLength as VoiceProfile["sentenceLength"])
      : "medium",
    emojiFrequency: (allowedFreq as readonly string[]).includes(
      raw.emojiFrequency as string,
    )
      ? (raw.emojiFrequency as VoiceProfile["emojiFrequency"])
      : "rare",
    emojis: Array.isArray(raw.emojis)
      ? raw.emojis.filter((e): e is string => typeof e === "string").slice(0, 8)
      : [],
    hooks: Array.isArray(raw.hooks)
      ? raw.hooks.filter((h): h is string => typeof h === "string").slice(0, 8)
      : [],
    vocabularyTells: Array.isArray(raw.vocabularyTells)
      ? raw.vocabularyTells
          .filter((v): v is string => typeof v === "string")
          .slice(0, 10)
      : [],
    avoid: Array.isArray(raw.avoid)
      ? raw.avoid.filter((a): a is string => typeof a === "string").slice(0, 10)
      : [],
    exampleOpening:
      typeof raw.exampleOpening === "string"
        ? raw.exampleOpening.trim()
        : "Shipped something I've been working on.",
    generatedAt: new Date().toISOString(),
  };
}

// ──────────────────────────────────────────────────────────────
// Draft generation
// ──────────────────────────────────────────────────────────────

export type DraftPlatform = "x_thread" | "linkedin" | "blog";

export interface BipEventInput {
  title: string;
  summary: string | null;
  url: string | null;
  repoFullName: string | null;
  metadata: Record<string, unknown> | null;
}

export interface DraftBlob {
  x_thread?: string[];
  linkedin?: string;
  blog?: { title: string; body_md: string };
}

const DRAFT_SYSTEM_PROMPT = `You draft build-in-public posts for a developer in their own voice. You are given:

  1. A "shipped event" — something the developer just released or merged.
  2. A voice profile extracted from their actual writing.
  3. 1-2 raw writing samples for tone reference.
  4. The list of platforms to draft for.

Output strict JSON shape (only include keys for requested platforms):

{
  "x_thread": ["tweet 1 ≤270 chars", "tweet 2 ≤270 chars", ...],  // 4-8 tweets
  "linkedin": "single post, 1200-1800 chars, line breaks ok",
  "blog": { "title": "≤80 chars", "body_md": "300-700 words, markdown" }
}

Hard rules — non-negotiable:

- Voice match comes first. Use the profile's hooks, vocab tells, sentence length, emoji frequency. Respect the "avoid" list.
- Honest. No "this changes everything" hyperbole. No invented metrics. If the user shipped a small thing, write a small post — don't inflate it.
- Concrete. Name what was shipped, why, the actual technical bits, what was hard, what's next. The reader should know more after reading than before.
- Anti-patterns to refuse:
    · NEVER include "a thread 🧵" or "🧵" markers
    · NEVER end with "thoughts?" / "let me know what you think" / "agree?" engagement bait
    · NEVER start LinkedIn with "I'm excited to announce" or "thrilled to share"
    · NEVER use rocket / 100 / fire emojis unless the voice profile shows the user actually uses them
    · NEVER fabricate quotes, numbers, or user reactions
    · NEVER hashtag-stuff (max 0-2 hashtags on LinkedIn, none on X)
- The first tweet / first line is the hook. It must do the work without an emoji.
- For x_thread: each tweet stands alone if possible. Last tweet has the link.
- For linkedin: one or two short paragraphs, easy to skim, no fake "story arc". Bold/italic markdown is fine in moderation.
- For blog: include code-style names with backticks, link inline with [text](url), short H2 sections allowed.

Return JSON only. No prose preamble, no markdown fences.`;

export interface GenerateDraftsArgs {
  event: BipEventInput;
  profile: VoiceProfile;
  rawSamples: string[];        // 1-2 raw samples for in-context tone
  platforms: DraftPlatform[];  // which keys to populate
}

/**
 * Generate platform-specific post drafts for one shipped event. Returns
 * a single DraftBlob containing every requested platform's draft.
 * Persisted as JSON in bip_drafts.content_json.
 */
export async function generateDrafts(
  args: GenerateDraftsArgs,
  ctx: BipAiContext,
): Promise<DraftBlob> {
  const { event, profile, rawSamples, platforms } = args;
  if (platforms.length === 0) {
    return {};
  }

  const samplesBlock = rawSamples
    .slice(0, 2)
    .map((s, i) => `Sample ${i + 1}:\n"""\n${s.slice(0, 1500)}\n"""`)
    .join("\n\n") || "(no raw samples provided)";

  const userPrompt = `Draft posts for these platforms: ${platforms.join(", ")}.

Shipped event:
  title: ${event.title}
  summary: ${event.summary ?? "(none)"}
  repo: ${event.repoFullName ?? "(none)"}
  url: ${event.url ?? "(none)"}
  metadata: ${event.metadata ? JSON.stringify(event.metadata).slice(0, 600) : "(none)"}

Voice profile:
${JSON.stringify(profile, null, 2)}

Raw writing samples for tone reference:
${samplesBlock}

Return strict JSON. Only include keys for the requested platforms.`;

  const raw = await callOpenRouter(
    ctx.apiKey,
    ctx.appUrl,
    DRAFT_SYSTEM_PROMPT,
    userPrompt,
    0.65,
  );
  const json = JSON.parse(unwrapJson(raw)) as Partial<DraftBlob>;
  return coerceDraft(json, platforms);
}

function coerceDraft(raw: Partial<DraftBlob>, want: DraftPlatform[]): DraftBlob {
  const out: DraftBlob = {};
  if (want.includes("x_thread")) {
    if (Array.isArray(raw.x_thread)) {
      const cleaned = raw.x_thread
        .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
        .map((t) => t.replace(/\s+$/g, ""))
        .slice(0, 10);
      if (cleaned.length > 0) out.x_thread = cleaned;
    }
  }
  if (want.includes("linkedin")) {
    if (typeof raw.linkedin === "string" && raw.linkedin.trim().length > 0) {
      out.linkedin = raw.linkedin.trim();
    }
  }
  if (want.includes("blog")) {
    if (raw.blog && typeof raw.blog === "object") {
      const blog = raw.blog as { title?: unknown; body_md?: unknown };
      if (typeof blog.title === "string" && typeof blog.body_md === "string") {
        out.blog = { title: blog.title.trim(), body_md: blog.body_md.trim() };
      }
    }
  }
  return out;
}

// ──────────────────────────────────────────────────────────────
// Recruiter inbound — fit + spam scoring
// ──────────────────────────────────────────────────────────────

export interface RecruiterTriageInput {
  fromName: string;
  fromEmail: string;
  fromCompany: string | null;
  roleTitle: string | null;
  roleLink: string | null;
  compNote: string | null;
  locationNote: string | null;
  body: string;
}

export interface RecruiterTriageContext {
  openToWorkBlurb: string | null;
  desiredRoles: string | null;
  desiredLocations: string | null;
  compMinUsd: number | null;
  compMaxUsd: number | null;
}

export interface TriageResult {
  fitScore: number;      // 0..100
  spamScore: number;     // 0..100
  fitReason: string;     // 1-sentence justification
}

const TRIAGE_SYSTEM_PROMPT = `You triage incoming recruiter messages on a developer's portfolio.

Output strict JSON: { "fitScore": 0..100, "spamScore": 0..100, "fitReason": "1 sentence ≤140 chars" }

Fit scoring (0..100, higher = better match for the developer):
  - role title overlaps with developer's desired roles → +30
  - location matches preferences (or remote when remote is allowed) → +15
  - comp signal present AND inside / above desired range → +25
  - tone is specific, mentions actual work or a specific repo → +15
  - the message is from a person, not a templated agency blast → +15
Subtract for vagueness, mismatched roles, sub-range comp, "contract/contract-to-hire" without indication of full-time path.

Spam scoring (0..100, higher = more likely spam):
  - generic intro with no role specifics → +40
  - body contains links to unrelated services (crypto, "trading platforms") → +60
  - non-personal greeting like "Dear professional" → +20
  - asks to schedule a call without naming the role → +25
  - missing email or fake-looking email → +30

fitReason: one sentence ≤140 chars, plain English, justifying the fit score. No emoji.

Return JSON only.`;

/**
 * Score an inbound recruiter message. Falls back to deterministic
 * defaults if the LLM call fails — the contact endpoint will still
 * persist the row and let the user inspect it manually.
 */
export async function triageRecruiterInbound(
  input: RecruiterTriageInput,
  context: RecruiterTriageContext,
  ctx: BipAiContext,
): Promise<TriageResult> {
  const userPrompt = `Developer preferences:
  desired roles: ${context.desiredRoles ?? "(unspecified)"}
  desired locations: ${context.desiredLocations ?? "(unspecified)"}
  comp range USD: ${
    context.compMinUsd || context.compMaxUsd
      ? `${context.compMinUsd ?? "?"} - ${context.compMaxUsd ?? "?"}`
      : "(unspecified)"
  }
  blurb: ${context.openToWorkBlurb ?? "(unspecified)"}

Incoming message:
  from: ${input.fromName} <${input.fromEmail}>
  company: ${input.fromCompany ?? "(unspecified)"}
  role title pitched: ${input.roleTitle ?? "(unspecified)"}
  role link: ${input.roleLink ?? "(unspecified)"}
  comp note: ${input.compNote ?? "(unspecified)"}
  location note: ${input.locationNote ?? "(unspecified)"}
  body: """
${input.body.slice(0, 4000)}
"""

Return JSON only.`;

  try {
    const raw = await callOpenRouter(
      ctx.apiKey,
      ctx.appUrl,
      TRIAGE_SYSTEM_PROMPT,
      userPrompt,
      0.2,
    );
    const json = JSON.parse(unwrapJson(raw)) as Partial<TriageResult>;
    const fit = clamp(toInt(json.fitScore, 50), 0, 100);
    const spam = clamp(toInt(json.spamScore, 0), 0, 100);
    const reason =
      typeof json.fitReason === "string" && json.fitReason.trim().length > 0
        ? json.fitReason.trim().slice(0, 160)
        : "Triage unavailable";
    return { fitScore: fit, spamScore: spam, fitReason: reason };
  } catch {
    return { fitScore: 50, spamScore: 0, fitReason: "Triage unavailable" };
  }
}

// ──────────────────────────────────────────────────────────────
// OpenRouter call (mirrors lib/resume-doc-ai.ts)
// ──────────────────────────────────────────────────────────────

interface OpenRouterResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

async function callOpenRouter(
  apiKey: string,
  appUrl: string,
  systemPrompt: string,
  userPrompt: string,
  temperature: number,
): Promise<string> {
  const resp = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": appUrl || "https://gitshow.io",
      "X-Title": "gitshow",
    },
    body: JSON.stringify({
      model: SONNET_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature,
      response_format: { type: "json_object" },
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`openrouter_${resp.status}: ${body.slice(0, 400)}`);
  }
  const data = (await resp.json()) as OpenRouterResponse;
  if (data.error) throw new Error(`openrouter_error: ${data.error.message}`);
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("openrouter_empty");
  return content;
}

function unwrapJson(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  }
  return trimmed;
}

function toInt(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  if (typeof v === "string") {
    const n = parseFloat(v);
    if (Number.isFinite(n)) return Math.round(n);
  }
  return fallback;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
