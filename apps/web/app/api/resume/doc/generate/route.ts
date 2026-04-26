import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireProApi } from "@/lib/entitlements";
import { loadDraftResume, loadPublishedResume } from "@/lib/resume-io";
import { writeResumeDoc } from "@/lib/resume-doc-io";
import { generateResumeDoc } from "@/lib/resume-doc-ai";

/**
 * POST /api/resume/doc/generate — (re)generate the ResumeDoc from the
 * user's portfolio Resume using Claude Sonnet 4.6 via OpenRouter.
 *
 * Source preference: published > draft. We prefer published because
 * that's what's "real" — but new users without a published portfolio
 * can still generate from their draft.
 */

export const maxDuration = 60;

export async function POST() {
  const gate = await requireProApi();
  if (!gate.ok) return gate.response;
  const session = gate.session;
  if (!session.user.login) {
    return NextResponse.json({ error: "no_handle" }, { status: 400 });
  }

  const { env } = await getCloudflareContext({ async: true });
  if (!env.BUCKET) {
    return NextResponse.json({ error: "r2_not_bound" }, { status: 500 });
  }
  if (!env.OPENROUTER_API_KEY) {
    return NextResponse.json(
      { error: "ai_not_configured", detail: "OPENROUTER_API_KEY missing" },
      { status: 500 },
    );
  }

  const handle = session.user.login;
  const [published, draft] = await Promise.all([
    loadPublishedResume(env.BUCKET, handle),
    loadDraftResume(env.BUCKET, handle),
  ]);
  const source = published ?? draft;
  if (!source) {
    return NextResponse.json(
      {
        error: "no_resume",
        detail: "Run a portfolio scan first — the resume is generated from it.",
      },
      { status: 404 },
    );
  }

  try {
    const generated = await generateResumeDoc(source, {
      apiKey: env.OPENROUTER_API_KEY,
      appUrl: env.NEXT_PUBLIC_APP_URL ?? "https://gitshow.io",
    });
    const written = await writeResumeDoc(env.BUCKET, handle, generated);
    return NextResponse.json({ doc: written });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json(
      { error: "generation_failed", detail: msg },
      { status: 502 },
    );
  }
}
