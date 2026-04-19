import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { z } from "zod";
import { auth } from "@/auth";
import { getScanByIdForUser, updateClaimStatus } from "@/lib/scans";

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
  const session = await auth();
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
