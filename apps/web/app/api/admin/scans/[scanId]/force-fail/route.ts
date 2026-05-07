import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAdminApi } from "@/lib/admin";
import { forceFailScan } from "@/lib/admin-scan-control";

/**
 * POST /api/admin/scans/[scanId]/force-fail — operator-only.
 *
 * Marks a scan failed (with reason "force-failed by admin") and
 * best-effort destroys the underlying Fly machine. Use when a scan is
 * stuck and a rerun isn't desired (e.g. user already abandoned the
 * onboarding).
 *
 * Idempotent: hitting an already-terminal scan returns ok with
 * `machine_destroyed: false`.
 */

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ scanId: string }> },
) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const { scanId } = await params;
  const { env } = await getCloudflareContext({ async: true });

  const result = await forceFailScan(
    env.DB,
    scanId,
    `force-failed by admin (${gate.session.user.login ?? gate.session.user.id})`,
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }
  return NextResponse.json(result);
}
