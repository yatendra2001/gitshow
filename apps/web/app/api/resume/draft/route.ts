import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getSession } from "@/auth";
import {
  loadDraftResume,
  patchDraftResume,
} from "@/lib/resume-io";

/**
 * GET  /api/resume/draft — returns the authenticated user's draft Resume.
 * PATCH /api/resume/draft — deep-merge a partial Resume into the draft.
 *
 * Ownership is session-bound: the handle is derived from
 * `session.user.login`, so a user can only ever read/mutate their own
 * draft. Array fields (work, projects, skills, blog, etc.) are replaced
 * wholesale when the patch provides them — the editor sends the full
 * section when a list changes.
 */

export async function GET() {
  const session = await getSession();
  if (!session?.user?.login) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { env } = await getCloudflareContext({ async: true });
  if (!env.BUCKET) {
    return NextResponse.json({ error: "r2_not_bound" }, { status: 500 });
  }

  const resume = await loadDraftResume(env.BUCKET, session.user.login);
  if (!resume) {
    return NextResponse.json(
      { error: "no_draft", detail: "No draft resume. Run a scan first." },
      { status: 404 },
    );
  }

  return NextResponse.json({ resume });
}

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session?.user?.login) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { env } = await getCloudflareContext({ async: true });
  if (!env.BUCKET) {
    return NextResponse.json({ error: "r2_not_bound" }, { status: 500 });
  }

  const body = (await req.json().catch(() => null)) as
    | { patch?: unknown }
    | null;
  if (!body || typeof body !== "object" || body.patch === undefined) {
    return NextResponse.json(
      { error: "invalid_body", detail: "Expected { patch: Partial<Resume> }" },
      { status: 400 },
    );
  }

  const result = await patchDraftResume(
    env.BUCKET,
    session.user.login,
    body.patch,
  );

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, issues: result.issues },
      { status: result.error === "no_draft" ? 404 : 400 },
    );
  }

  return NextResponse.json({ resume: result.resume });
}
