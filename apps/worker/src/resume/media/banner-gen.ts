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
const BANNER_MODEL = "google/gemini-3.1-flash-image-preview";

export interface BannerGenInput {
  project: {
    id: string;
    title: string;
    purpose: string;
    tags: string[];
    kind: string;
  };
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
      },
      body: JSON.stringify({
        model: BANNER_MODEL,
        messages: [{ role: "user", content: prompt }],
        modalities: ["image", "text"],
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
  return `Generate a sober, minimalist abstract banner image for a software project
portfolio card. 1200×630 landscape.

Project title: ${project.title}
What it does: ${project.purpose}
Technologies: ${tags}
Project kind: ${project.kind}

STRICT requirements:
- NO text, letters, words, numbers, logos, or typography ANYWHERE in the image.
  (AI text rendering is unreliable; portfolio cards have a real text overlay.)
- Abstract geometric shapes, soft gradients, or flowing forms — never literal
  illustrations of the product, never stock-photo scenes, never people.
- Muted, sophisticated palette (1-3 hues). Avoid pure saturated colors.
  Think: slate + soft blue, warm charcoal + peach, forest + sand.
- Centered composition with a calm focal point. Leave breathing room;
  the viewer's attention goes to the overlaid text, not the image.
- Professional portfolio aesthetic. Think: Apple keynote backgrounds,
  Linear changelog headers, Stripe hero art, Vercel OG images.
- Dark enough to work under white text overlay; not so dark it loses detail.

Output: one image, 1200×630 landscape, no text.`;
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
