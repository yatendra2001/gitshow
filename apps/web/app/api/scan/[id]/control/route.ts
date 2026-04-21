import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { z } from "zod";
import { getSession } from "@/auth";
import { getScanByIdForUser } from "@/lib/scans";

/**
 * POST /api/scan/[id]/control
 *
 * Body: { action: "stop" } — the only action in M3.
 *
 * Writes a pending row to scan_controls. The worker polls this table
 * every ~2s (see apps/worker src/control-poll.ts) and acks by writing
 * a control-ack event. Soft stop: the worker finishes the current
 * stage cleanly and exits, rather than killing mid-LLM-call.
 */

const BodySchema = z.object({
  action: z.enum(["stop"]),
  note: z.string().max(200).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const parse = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parse.success) {
    return NextResponse.json(
      { error: "invalid body", issues: parse.error.issues },
      { status: 400 },
    );
  }

  const { id } = await params;
  const { env } = await getCloudflareContext({ async: true });
  const scan = await getScanByIdForUser(env.DB, id, session.user.id);
  if (!scan) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (scan.status === "succeeded" || scan.status === "failed" || scan.status === "cancelled") {
    return NextResponse.json(
      { error: "scan_terminal", status: scan.status },
      { status: 409 },
    );
  }

  await env.DB.prepare(
    `INSERT INTO scan_controls (scan_id, user_id, action, note, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      session.user.id,
      parse.data.action,
      parse.data.note ?? null,
      Date.now(),
    )
    .run();

  // Also mark the scan as cancelling so the UI reflects the state
  // immediately even before the worker acks.
  await env.DB.prepare(
    `UPDATE scans SET status = 'cancelled', updated_at = ? WHERE id = ?`,
  )
    .bind(Date.now(), id)
    .run();

  return NextResponse.json({ ok: true });
}
