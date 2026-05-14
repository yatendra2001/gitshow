import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getSession } from "@/auth";
import { requireProApi } from "@/lib/entitlements";
import {
  deleteTailoredResume,
  loadTailoredResume,
  patchTailoredResume,
} from "@/lib/tailored-resume-io";

/**
 * GET    /api/resume/tailored/:id  — return one tailored resume.
 * PATCH  /api/resume/tailored/:id  — deep-merge a Partial<ResumeDoc> into the variant's doc.
 * DELETE /api/resume/tailored/:id  — drop the variant + its index entry.
 *
 * PATCH lets the editor at `/app/resume/[id]` persist per-keystroke
 * edits to the underlying ResumeDoc without re-running generation.
 * The meta layer (job title, company, JD) is immutable from the
 * client — those come from the AI extraction + the original JD.
 */

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user?.login) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { env } = await getCloudflareContext({ async: true });
  if (!env.BUCKET) {
    return NextResponse.json({ error: "r2_not_bound" }, { status: 500 });
  }
  const { id } = await ctx.params;
  const tailored = await loadTailoredResume(env.BUCKET, session.user.login, id);
  if (!tailored) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ tailored });
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const gate = await requireProApi();
  if (!gate.ok) return gate.response;
  if (!gate.session.user.login) {
    return NextResponse.json({ error: "no_handle" }, { status: 400 });
  }
  const { env } = await getCloudflareContext({ async: true });
  if (!env.BUCKET) {
    return NextResponse.json({ error: "r2_not_bound" }, { status: 500 });
  }
  const { id } = await ctx.params;

  const body = (await req.json().catch(() => null)) as
    | { patch?: unknown }
    | null;
  if (!body || body.patch === undefined) {
    return NextResponse.json(
      { error: "invalid_body", detail: "Expected { patch: Partial<ResumeDoc> }" },
      { status: 400 },
    );
  }

  const result = await patchTailoredResume(
    env.BUCKET,
    gate.session.user.login,
    id,
    body.patch,
  );
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, issues: result.issues },
      { status: result.error === "not_found" ? 404 : 400 },
    );
  }
  return NextResponse.json({ tailored: result.tailored });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const gate = await requireProApi();
  if (!gate.ok) return gate.response;
  if (!gate.session.user.login) {
    return NextResponse.json({ error: "no_handle" }, { status: 400 });
  }
  const { env } = await getCloudflareContext({ async: true });
  if (!env.BUCKET) {
    return NextResponse.json({ error: "r2_not_bound" }, { status: 500 });
  }
  const { id } = await ctx.params;
  try {
    await deleteTailoredResume(env.BUCKET, gate.session.user.login, id);
  } catch (err) {
    return NextResponse.json(
      { error: "delete_failed", detail: (err as Error).message },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
