import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getSession } from "@/auth";
import { loadTailoredIndex } from "@/lib/tailored-resume-io";

/**
 * GET /api/resume/tailored
 *
 * Returns the list of tailored-resume summaries for the authenticated
 * user (newest first). One light blob fetch — does NOT read each
 * tailored doc.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session?.user?.login) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { env } = await getCloudflareContext({ async: true });
  if (!env.BUCKET) {
    return NextResponse.json({ error: "r2_not_bound" }, { status: 500 });
  }
  const index = await loadTailoredIndex(env.BUCKET, session.user.login);
  return NextResponse.json({ items: index.items });
}
