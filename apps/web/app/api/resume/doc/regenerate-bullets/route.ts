import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireProApi } from "@/lib/entitlements";
import { loadDraftResume, loadPublishedResume } from "@/lib/resume-io";
import { regenerateExperienceBullets } from "@/lib/resume-doc-ai";
import type { ExperienceEntry } from "@gitshow/shared/resume-doc";

/**
 * POST /api/resume/doc/regenerate-bullets
 * Body: { entry: ExperienceEntry }
 *
 * Returns: { bullets: string[] } — the new bullet list for the role.
 * The client folds the result into local state and PATCHes through the
 * standard /api/resume/doc endpoint.
 */

export const maxDuration = 30;

export async function POST(req: Request) {
  const gate = await requireProApi();
  if (!gate.ok) return gate.response;
  const session = gate.session;
  if (!session.user.login) {
    return NextResponse.json({ error: "no_handle" }, { status: 400 });
  }

  const { env } = await getCloudflareContext({ async: true });
  if (!env.OPENROUTER_API_KEY) {
    return NextResponse.json(
      { error: "ai_not_configured" },
      { status: 500 },
    );
  }

  const body = (await req.json().catch(() => null)) as
    | { entry?: ExperienceEntry }
    | null;
  if (!body?.entry?.id || !body.entry.company || !body.entry.title) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const handle = session.user.login;
  const [published, draft] = await Promise.all([
    loadPublishedResume(env.BUCKET, handle),
    loadDraftResume(env.BUCKET, handle),
  ]);
  const source = published ?? draft;
  if (!source) {
    return NextResponse.json({ error: "no_resume" }, { status: 404 });
  }

  try {
    const bullets = await regenerateExperienceBullets(body.entry, source, {
      apiKey: env.OPENROUTER_API_KEY,
      appUrl: env.NEXT_PUBLIC_APP_URL ?? "https://gitshow.io",
    });
    return NextResponse.json({ bullets });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json(
      { error: "regen_failed", detail: msg },
      { status: 502 },
    );
  }
}
