import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireProApi } from "@/lib/entitlements";
import { extractVoiceProfile } from "@/lib/bip-ai";
import {
  listVoiceSamples,
  loadVoiceProfile,
  replaceVoiceSamples,
  upsertVoiceProfile,
} from "@/lib/bip-data";
import { siteConfig } from "@/lib/marketing-config";

/**
 * /api/voice/samples
 *
 *   GET   → { samples, profile, sample_count, generated_at }
 *   POST  → replace samples + regenerate the voice profile
 *
 * The profile is always re-derived from the latest sample set —
 * we never let it drift from the raw text the user provided. That
 * means every POST burns one Sonnet call; the UI throttles by only
 * allowing save on a real change.
 */

export const dynamic = "force-dynamic";

const ALLOWED_KINDS = new Set(["tweet", "linkedin", "blog", "slack", "other"]);
const MAX_SAMPLES = 6;
const MAX_BODY_CHARS = 8000;

export async function GET() {
  const gate = await requireProApi();
  if (!gate.ok) return gate.response;
  const userId = gate.session.user.id;
  const { env } = await getCloudflareContext({ async: true });
  const [samples, profile] = await Promise.all([
    listVoiceSamples(env.DB, userId),
    loadVoiceProfile(env.DB, userId),
  ]);
  return NextResponse.json({
    samples: samples.map((s) => ({
      id: s.id,
      kind: s.kind,
      source_url: s.source_url,
      body: s.body,
      created_at: s.created_at,
    })),
    profile: profile?.profile ?? null,
    sample_count: profile?.sample_count ?? samples.length,
    generated_at: profile?.generated_at ?? null,
  });
}

interface PostBody {
  samples?: Array<{
    kind?: string;
    body?: string;
    source_url?: string | null;
  }>;
}

export async function POST(req: Request) {
  const gate = await requireProApi();
  if (!gate.ok) return gate.response;
  const userId = gate.session.user.id;

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const rawSamples = Array.isArray(body.samples) ? body.samples : [];
  const cleaned = rawSamples
    .map((s) => ({
      kind: ALLOWED_KINDS.has(s.kind ?? "")
        ? (s.kind as "tweet" | "linkedin" | "blog" | "slack" | "other")
        : ("other" as const),
      body: typeof s.body === "string" ? s.body.trim().slice(0, MAX_BODY_CHARS) : "",
      source_url:
        typeof s.source_url === "string" && s.source_url.trim().length > 0
          ? s.source_url.trim().slice(0, 800)
          : null,
    }))
    .filter((s) => s.body.length >= 40)
    .slice(0, MAX_SAMPLES);

  if (cleaned.length < 2) {
    return NextResponse.json(
      { error: "need_min_samples", message: "Paste at least 2 writing samples, each 40+ chars." },
      { status: 422 },
    );
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "openrouter_unconfigured" },
      { status: 500 },
    );
  }

  const { env } = await getCloudflareContext({ async: true });

  // Persist samples first so a profile-generation failure doesn't lose
  // what the user typed.
  await replaceVoiceSamples(env.DB, userId, cleaned);

  let profile;
  try {
    profile = await extractVoiceProfile(
      cleaned.map((s) => ({ kind: s.kind, body: s.body })),
      { apiKey, appUrl: siteConfig.url },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json(
      {
        error: "profile_generation_failed",
        message: msg.slice(0, 200),
        samples_saved: true,
      },
      { status: 502 },
    );
  }

  await upsertVoiceProfile(env.DB, userId, profile, cleaned.length);

  return NextResponse.json({
    ok: true,
    profile,
    sample_count: cleaned.length,
  });
}
