/**
 * Banner generator (tier 4 of the media pipeline).
 *
 * When a featured Project has no hero from homepage/README/YouTube,
 * we ask Gemini Flash Image (via OpenRouter's chat-completions
 * surface) to generate a sober abstract banner. The prompt template
 * lives in §8.4 of session-8-plan — short + opinionated so every
 * generated banner matches a consistent "sober portfolio" aesthetic.
 *
 * Costs ~$0.003/image at today's OpenRouter prices. We emit a trace
 * event for every attempt, so a post-scan audit can see exactly which
 * projects hit tier 4 and how much they cost.
 *
 * Safety:
 *   - Strict no-text rule in the prompt (AI text rendering is bad,
 *     and we put real UI text on top of the image anyway).
 *   - Only uses project metadata — never the user's real name/email,
 *     never private repo content.
 *   - On any failure (auth, refusal, parse error), returns null so
 *     the render layer falls back to the CSS initials avatar.
 */

import type { ScanTrace } from "../observability/trace.js";

const OPENROUTER_CHAT = "https://openrouter.ai/api/v1/chat/completions";
/**
 * Nano Banana 2 — Google's Gemini 3 Pro Image Preview. Released
 * Nov 20 2025; the successor to Gemini 2.5 Flash Image (the
 * original "Nano Banana"). Pricing on OpenRouter: $2/M input,
 * $12/M output; per generated image hovers at ~$0.02-0.04.
 *
 * The previous slug `gemini-3.1-flash-image-preview` was a typo —
 * that model never existed, so banner-gen silently no-op'd on
 * every project (404 → trace.rejectionReason="http_404").
 */
const BANNER_MODEL = "google/gemini-3-pro-image-preview";

export interface BannerGenInput {
  project: {
    id: string;
    title: string;
    purpose: string;
    tags: string[];
    kind: string;
  };
  /** Scan id — passed as OpenRouter session_id so the banner-gen
   *  call shows up in the same dashboard session as the rest of
   *  the scan's LLM activity. */
  scanId?: string;
  trace?: ScanTrace;
}

export interface BannerGenResult {
  bytes: Uint8Array;
  contentType: string;
  costUsd?: number;
}

/**
 * Generate a project hero banner. Returns null when the API key is
 * absent, the model refuses, or parsing fails. Always emits exactly
 * one `trace.mediaBannerGenerated` event for observability.
 */
export async function generateProjectBanner(
  input: BannerGenInput,
): Promise<BannerGenResult | null> {
  const apiKey =
    (globalThis as { process?: { env?: Record<string, string | undefined> } })
      .process?.env?.OPENROUTER_API_KEY;

  const startedAt = Date.now();

  if (!apiKey) {
    input.trace?.mediaBannerGenerated({
      projectId: input.project.id,
      model: BANNER_MODEL,
      ok: false,
      durationMs: 0,
      rejectionReason: "no_api_key",
    });
    return null;
  }

  const prompt = buildPrompt(input.project);

  try {
    const resp = await fetch(OPENROUTER_CHAT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // Group banner-gen calls under the same OpenRouter dashboard
        // session as the rest of the scan's LLM activity. Without
        // this, image gen was invisible from the trace's session
        // view and impossible to reconcile with judge/merger costs.
        ...(input.scanId ? { "X-Session-Id": input.scanId } : {}),
        // Standard attribution headers OpenRouter uses for the
        // model leaderboard + abuse routing.
        "HTTP-Referer": "https://github.com/yatendrakumar/gitshow",
        "X-Title": "GitShow Banner Generation",
      },
      body: JSON.stringify({
        model: BANNER_MODEL,
        messages: [{ role: "user", content: prompt }],
        modalities: ["image", "text"],
        ...(input.scanId ? { session_id: input.scanId } : {}),
      }),
    });

    const durationMs = Date.now() - startedAt;

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      input.trace?.mediaBannerGenerated({
        projectId: input.project.id,
        model: BANNER_MODEL,
        ok: false,
        durationMs,
        rejectionReason: `http_${resp.status}: ${text.slice(0, 200)}`,
      });
      return null;
    }

    const data = (await resp.json()) as {
      choices?: Array<{
        message?: {
          images?: Array<{ image_url?: { url?: string } }>;
        };
      }>;
      usage?: { cost?: number };
    };

    const imageUrl =
      data.choices?.[0]?.message?.images?.[0]?.image_url?.url ?? null;
    if (!imageUrl) {
      input.trace?.mediaBannerGenerated({
        projectId: input.project.id,
        model: BANNER_MODEL,
        ok: false,
        durationMs,
        rejectionReason: "no_image_in_response",
      });
      return null;
    }

    const decoded = await decodeImage(imageUrl);
    if (!decoded) {
      input.trace?.mediaBannerGenerated({
        projectId: input.project.id,
        model: BANNER_MODEL,
        ok: false,
        durationMs,
        rejectionReason: "decode_failed",
      });
      return null;
    }

    const costUsd = data.usage?.cost;
    input.trace?.mediaBannerGenerated({
      projectId: input.project.id,
      model: BANNER_MODEL,
      ok: true,
      durationMs,
      costUsd,
    });

    return { bytes: decoded.bytes, contentType: decoded.contentType, costUsd };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const reason = err instanceof Error ? err.message : String(err);
    input.trace?.mediaBannerGenerated({
      projectId: input.project.id,
      model: BANNER_MODEL,
      ok: false,
      durationMs,
      rejectionReason: `exception: ${reason.slice(0, 200)}`,
    });
    return null;
  }
}

// ─── helpers ─────────────────────────────────────────────────────────

function buildPrompt(project: {
  title: string;
  purpose: string;
  tags: string[];
  kind: string;
}): string {
  const tags = project.tags.slice(0, 5).join(", ");
  // Two-part structure (per user feedback after seeing "Lorem ipsum"
  // hallucinated onto a generated banner):
  //   1. PRODUCT CONTEXT — model knows what this thing is.
  //   2. ATMOSPHERIC ASK — frame the deliverable as ambient mood
  //      art, not a "cover" or "card", so the model never reaches
  //      for text-on-poster mental patterns.
  //
  // We explicitly enumerate the failure modes we've seen in the
  // wild (Lorem ipsum placeholder, UI mockup screens, fake logos)
  // because abstract negation ("no text") doesn't always hold —
  // listing concrete anti-patterns does.
  return `## What this product is
"${project.title}" — ${project.purpose}
Built with: ${tags || "(unspecified)"}
Type: ${project.kind}

## What to generate
A calm, atmospheric texture image that evokes the SPIRIT of this product.
Think: ambient mood backdrop, not a "poster" or "cover" or "card".
1200×630 landscape, dark theme.

Reference aesthetic — match this energy precisely:
  - Apple keynote backdrops (subtle gradient depth, no decoration)
  - Linear changelog headers (single soft glow, generous negative space)
  - Vercel OG art (clean geometric pull, deliberate restraint)
  - Aurora over still water (organic motion, muted palette)

The product context is for VIBE only — don't illustrate the product.
A code-editor app doesn't need brackets in the image; a podcast app
doesn't need a microphone. Translate the feeling, not the literal thing.

## Hard rules — these failures have happened before
- ABSOLUTELY NO TEXT. No letters, no words, no numbers, no glyphs of any
  language, no "Lorem ipsum", no captions, no labels, no signage, no
  watermarks. The image will sit BEHIND a real text overlay; any text
  you generate will collide with it and look broken. If you feel the
  composition wants text, leave that area empty instead.
- NO UI mockups. No phone frames, no laptop frames, no app screenshots,
  no chat bubbles, no buttons, no cursors, no windows, no toolbars.
- NO logos, brand marks, icons, emoji, or stylised symbols.
- NO people, faces, hands, body parts, or character art.
- NO literal objects from the product domain (no books for a reading
  app, no notes for a music app, no graphs for an analytics app).
- NO stock-photo scenes, no realistic photography.

## Style requirements
- Muted sophisticated palette: 1-3 hues max. Avoid pure saturated
  primary colours. Examples that work: slate + soft blue, warm
  charcoal + dusty peach, deep forest + sand, midnight + lavender.
- Composition: a single calm focal point with generous breathing
  room. Asymmetric works; "card-shaped" centred panels do not.
- Tonal range: dark enough that white overlay text has contrast, not
  so dark that the image loses detail. Mid-tone richness > flat black.
- Texture, not illustration: think soft gradient meshes, fluid motion
  blur, gentle volumetric light, ambient noise — not crisp shapes.

Output: one 1200×630 landscape PNG. Atmosphere only. No text.`;
}

async function decodeImage(
  imageUrl: string,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  if (imageUrl.startsWith("data:")) {
    // data:image/png;base64,AAAA...
    const match = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;
    const contentType = match[1]!;
    const b64 = match[2]!;
    try {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return { bytes, contentType };
    } catch {
      return null;
    }
  }

  // Remote URL — fetch it.
  try {
    const resp = await fetch(imageUrl);
    if (!resp.ok) return null;
    const contentType = resp.headers.get("content-type") ?? "image/png";
    const buf = await resp.arrayBuffer();
    return { bytes: new Uint8Array(buf), contentType };
  } catch {
    return null;
  }
}
