import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { z } from "zod";
import { getSession } from "@/auth";
import { getScanByIdForUser } from "@/lib/scans";

/**
 * POST /api/scan/[id]/answer
 *
 * Body: { question_id: string, answer: string }
 *
 * The worker emits an `agent-question` event + writes to
 * agent_questions. The web layer exposes this endpoint for the user
 * to send their answer back. Worker polls agent_answers and resumes.
 *
 * Idempotent on question_id — re-submitting the same answer is a
 * no-op. The 30-minute timeout on the question is enforced on the
 * worker side (if expires_at passed, the worker uses default_answer).
 */

const BodySchema = z.object({
  question_id: z.string().min(1).max(80),
  answer: z.string().max(1000),
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

  // Ensure the question exists and belongs to this scan.
  const question = await env.DB.prepare(
    `SELECT id, expires_at FROM agent_questions WHERE id = ? AND scan_id = ? LIMIT 1`,
  )
    .bind(parse.data.question_id, id)
    .first<{ id: string; expires_at: number }>();
  if (!question) {
    return NextResponse.json({ error: "unknown_question" }, { status: 404 });
  }

  // Insert answer — ON CONFLICT ignore so the call is idempotent.
  await env.DB.prepare(
    `INSERT INTO agent_answers (question_id, answer, source, answered_at)
     VALUES (?, ?, 'user', ?)
     ON CONFLICT(question_id) DO NOTHING`,
  )
    .bind(parse.data.question_id, parse.data.answer, Date.now())
    .run();

  return NextResponse.json({ ok: true });
}
