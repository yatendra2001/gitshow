import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireProApi } from "@/lib/entitlements";
import {
  BIP_DRAFT_MODEL,
  generateDrafts,
  type DraftPlatform,
} from "@/lib/bip-ai";
import {
  createEventAndDraft,
  listVoiceSamples,
  loadAudienceConfig,
  loadVoiceProfile,
  type BipEventRow,
} from "@/lib/bip-data";
import { siteConfig } from "@/lib/marketing-config";

/**
 * POST /api/build/draft
 *
 * Body:
 *   {
 *     event: {
 *       source: 'manual' | 'kg_project',
 *       title: string,
 *       summary?: string,
 *       url?: string,
 *       repoFullName?: string,
 *       metadata?: object,
 *       significance?: 1..10,
 *       occurredAt?: epoch ms (defaults to now)
 *     },
 *     platforms?: DraftPlatform[]   // defaults to audience config
 *   }
 *
 * Response:
 *   { ok, draftId, eventId, content, model }
 *
 * Side effects: writes 1 row to bip_events + 1 row to bip_drafts.
 */

export const dynamic = "force-dynamic";

const ALLOWED_PLATFORMS: DraftPlatform[] = ["x_thread", "linkedin", "blog"];
const ALLOWED_SOURCES: BipEventRow["source"][] = [
  "manual",
  "kg_project",
  "gh_release",
  "gh_pr_merged",
  "star_milestone",
];

interface PostBody {
  event?: {
    source?: string;
    title?: string;
    summary?: string | null;
    url?: string | null;
    repoFullName?: string | null;
    metadata?: Record<string, unknown> | null;
    significance?: number;
    occurredAt?: number;
  };
  platforms?: string[];
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

  const ev = body.event ?? {};
  const title = typeof ev.title === "string" ? ev.title.trim() : "";
  if (title.length < 3) {
    return NextResponse.json({ error: "missing_title" }, { status: 422 });
  }
  const source: BipEventRow["source"] =
    ALLOWED_SOURCES.includes(ev.source as BipEventRow["source"])
      ? (ev.source as BipEventRow["source"])
      : "manual";

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "openrouter_unconfigured" },
      { status: 500 },
    );
  }

  const { env } = await getCloudflareContext({ async: true });

  const [profileRow, samples, audience] = await Promise.all([
    loadVoiceProfile(env.DB, userId),
    listVoiceSamples(env.DB, userId),
    loadAudienceConfig(env.DB, userId),
  ]);

  if (!profileRow) {
    return NextResponse.json(
      {
        error: "voice_uncalibrated",
        message:
          "Calibrate your voice at /app/voice before generating drafts. Two writing samples is enough.",
      },
      { status: 422 },
    );
  }

  const platformsIn = Array.isArray(body.platforms)
    ? (body.platforms.filter((p): p is DraftPlatform =>
        ALLOWED_PLATFORMS.includes(p as DraftPlatform),
      ) as DraftPlatform[])
    : audience.platforms;
  const platforms = platformsIn.length > 0 ? platformsIn : audience.platforms;

  let content;
  try {
    content = await generateDrafts(
      {
        event: {
          title,
          summary: typeof ev.summary === "string" ? ev.summary : null,
          url: typeof ev.url === "string" ? ev.url : null,
          repoFullName: typeof ev.repoFullName === "string" ? ev.repoFullName : null,
          metadata: ev.metadata ?? null,
        },
        profile: profileRow.profile,
        rawSamples: samples.slice(0, 2).map((s) => s.body),
        platforms,
      },
      { apiKey, appUrl: siteConfig.url },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json(
      { error: "draft_generation_failed", message: msg.slice(0, 200) },
      { status: 502 },
    );
  }

  if (Object.keys(content).length === 0) {
    return NextResponse.json(
      { error: "draft_empty", message: "Model returned no usable content." },
      { status: 502 },
    );
  }

  const significance = clampInt(ev.significance, 7, 1, 10);
  const occurredAt = typeof ev.occurredAt === "number" ? ev.occurredAt : Date.now();

  const { eventId, draftId } = await createEventAndDraft(env.DB, userId, {
    source,
    title,
    summary: typeof ev.summary === "string" ? ev.summary : null,
    url: typeof ev.url === "string" ? ev.url : null,
    repoFullName: typeof ev.repoFullName === "string" ? ev.repoFullName : null,
    metadata: ev.metadata ?? null,
    significance,
    occurredAt,
    draftContent: content,
    model: BIP_DRAFT_MODEL,
  });

  return NextResponse.json({
    ok: true,
    eventId,
    draftId,
    content,
    model: BIP_DRAFT_MODEL,
  });
}

function clampInt(
  v: unknown,
  fallback: number,
  lo: number,
  hi: number,
): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return Math.max(lo, Math.min(hi, Math.round(v)));
}
