import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getSession } from "@/auth";
import { requireProApi } from "@/lib/entitlements";
import { loadResumeDoc, patchResumeDoc } from "@/lib/resume-doc-io";

/**
 * GET   /api/resume/doc    — return the authenticated user's ResumeDoc
 * PATCH /api/resume/doc    — deep-merge a partial ResumeDoc
 *
 * 404 from GET means "no doc yet" — the client should call
 * /api/resume/doc/generate to create one from the published Resume.
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
  const doc = await loadResumeDoc(env.BUCKET, session.user.login);
  if (!doc) {
    return NextResponse.json(
      { error: "no_doc", detail: "Resume not generated yet." },
      { status: 404 },
    );
  }
  return NextResponse.json({ doc });
}

export async function PATCH(req: Request) {
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

  const body = (await req.json().catch(() => null)) as
    | { patch?: unknown }
    | null;
  if (!body || body.patch === undefined) {
    return NextResponse.json(
      { error: "invalid_body", detail: "Expected { patch: Partial<ResumeDoc> }" },
      { status: 400 },
    );
  }

  const result = await patchResumeDoc(env.BUCKET, session.user.login, body.patch);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, issues: result.issues },
      { status: result.error === "no_doc" ? 404 : 400 },
    );
  }
  return NextResponse.json({ doc: result.doc });
}
