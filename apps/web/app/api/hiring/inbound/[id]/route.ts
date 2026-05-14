import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireProApi } from "@/lib/entitlements";
import { markInboundStatus, type RecruiterInboundRow } from "@/lib/bip-data";

/**
 * PATCH /api/hiring/inbound/[id] — update an inbound's status.
 *
 *   { status: 'new' | 'read' | 'replied' | 'archived' | 'spam' }
 */

export const dynamic = "force-dynamic";

const VALID: RecruiterInboundRow["status"][] = [
  "new",
  "read",
  "replied",
  "archived",
  "spam",
];

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const gate = await requireProApi();
  if (!gate.ok) return gate.response;
  const userId = gate.session.user.id;
  const { id } = await ctx.params;
  const inboundId = Number(id);
  if (!Number.isInteger(inboundId) || inboundId <= 0) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 });
  }

  let body: { status?: string };
  try {
    body = (await req.json()) as { status?: string };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const status = body.status as RecruiterInboundRow["status"] | undefined;
  if (!status || !VALID.includes(status)) {
    return NextResponse.json({ error: "bad_status" }, { status: 400 });
  }

  const { env } = await getCloudflareContext({ async: true });
  await markInboundStatus(env.DB, userId, inboundId, status);
  return NextResponse.json({ ok: true });
}
