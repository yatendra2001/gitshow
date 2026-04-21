import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getSession } from "@/auth";
import { getIntakeForUser } from "@/lib/intake";

/**
 * GET /api/intake/[id]
 *
 * Polled by the intake page until status becomes `ready` (questions
 * are populated) or `failed`. Responds with the intake view shape
 * the UI can render directly.
 *
 * The agent is expected to finish in 20-60s. The client polls at
 * ~1-2s cadence during that window.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { id } = await params;
  const { env } = await getCloudflareContext({ async: true });
  const intake = await getIntakeForUser(env.DB, id, session.user.id);
  if (!intake) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json(intake);
}
