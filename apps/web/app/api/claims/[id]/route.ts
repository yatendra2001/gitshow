import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { z } from "zod";
import { getSession } from "@/auth";
import { getScanByIdForUser, updateClaimStatus } from "@/lib/scans";

/**
 * DELETE /api/claims/[id]
 *
 * Permanently removes a claim from the profile. Used by the inline
 * editor's per-row remove buttons so a user can cut a number /
 * pattern / shipped item / disclosure they don't want shown.
 *
 * Permission: user must own the parent scan. The row is hard-deleted;
 * there's no "user_removed" status because the claim is gone from
 * both the profile and the public /{handle} card (mergeUserEdits
 * won't find it anymore).
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { id: claimId } = await params;

  const { env } = await getCloudflareContext({ async: true });
  const claim = await env.DB.prepare(
    `SELECT id, scan_id FROM claims WHERE id = ? LIMIT 1`,
  )
    .bind(claimId)
    .first<{ id: string; scan_id: string }>();
  if (!claim) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const scan = await getScanByIdForUser(
    env.DB,
    claim.scan_id,
    session.user.id,
  );
  if (!scan) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await env.DB.prepare(`DELETE FROM claims WHERE id = ?`).bind(claimId).run();
  return NextResponse.json({ ok: true });
}

/**
 * PATCH /api/claims/[id]
 *
 * In-place claim edits (no Fly roundtrip). Three operations:
 *   - approve         → status = user_approved
 *   - reject          → status = user_rejected
 *   - edit(newText)   → status = user_edited, preserve original_text
 *
 * Permission: user must own the parent scan.
 */

const BodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("reject") }),
  z.object({ action: z.literal("edit"), text: z.string().min(1).max(2000) }),
]);

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { id: claimId } = await params;

  const parse = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parse.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const body = parse.data;

  const { env } = await getCloudflareContext({ async: true });
  const claim = await env.DB.prepare(
    `SELECT id, scan_id, text FROM claims WHERE id = ? LIMIT 1`,
  )
    .bind(claimId)
    .first<{ id: string; scan_id: string; text: string }>();
  if (!claim) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const scan = await getScanByIdForUser(
    env.DB,
    claim.scan_id,
    session.user.id,
  );
  if (!scan) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  switch (body.action) {
    case "approve":
      await updateClaimStatus(env.DB, claimId, { status: "user_approved" });
      break;
    case "reject":
      await updateClaimStatus(env.DB, claimId, { status: "user_rejected" });
      break;
    case "edit":
      await updateClaimStatus(env.DB, claimId, {
        status: "user_edited",
        text: body.text,
        original_text: claim.text,
      });
      break;
  }

  return NextResponse.json({ ok: true });
}
