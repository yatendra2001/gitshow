import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getSession } from "@/auth";
import { requireProApi } from "@/lib/entitlements";
import {
  deleteTailoredResume,
  loadTailoredResume,
} from "@/lib/tailored-resume-io";

/**
 * GET /api/resume/tailored/:id    — return one tailored resume.
 * DELETE /api/resume/tailored/:id — drop one tailored resume + its index entry.
 *
 * No PATCH endpoint yet — tailored variants are meant to be quick
 * snapshots tied to a JD; if the user wants to edit deeply they
 * "promote" it to the base resume (a separate, future affordance).
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
