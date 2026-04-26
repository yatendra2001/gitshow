import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getSession } from "@/auth";
import { FlyClient } from "@gitshow/shared/cloud/fly";

/**
 * POST /api/scan/{scanId}/cancel — owner-only scan cancellation.
 *
 * Destroys the underlying Fly Machine (if one was spawned) and marks
 * the scan as 'cancelled' in D1. Already-terminal scans (succeeded /
 * failed / cancelled) are no-ops returning 409 so callers can show a
 * sensible UI message.
 *
 * Why force-destroy: the worker's pipeline doesn't listen for any
 * cancel signal, and ephemeral scan machines have `restart_policy =
 * no`. Destroying the machine is the cheapest way to halt all
 * in-flight git clones / LLM calls / fetcher fan-out.
 */

interface ScanRow {
  id: string;
  user_id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  fly_machine_id: string | null;
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ scanId: string }> },
) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { scanId } = await params;
  const { env } = await getCloudflareContext({ async: true });

  const scan = await env.DB.prepare(
    `SELECT id, user_id, status, fly_machine_id
       FROM scans WHERE id = ? AND user_id = ? LIMIT 1`,
  )
    .bind(scanId, session.user.id)
    .first<ScanRow>();

  if (!scan) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (scan.status !== "queued" && scan.status !== "running") {
    return NextResponse.json(
      { error: "not_cancellable", status: scan.status },
      { status: 409 },
    );
  }

  // Best-effort machine destroy. We mark the scan cancelled regardless
  // of the destroy result — leaving a scan in 'running' state when the
  // user has explicitly asked to cancel is a worse UX than a brief
  // window where the machine outlives the row. Fly's `restart_policy =
  // no` means the orphan machine will exit on its own once the
  // pipeline finishes (or fails). Surface the destroy error in the
  // response so the UI can warn if cleanup didn't succeed.
  let destroyError: string | undefined;
  if (scan.fly_machine_id) {
    try {
      const fly = FlyClient.fromEnv();
      await fly.destroyMachine(scan.fly_machine_id, true);
    } catch (err) {
      destroyError =
        err instanceof Error ? err.message.slice(0, 240) : String(err);
    }
  }

  const now = Date.now();
  await env.DB.prepare(
    `UPDATE scans
        SET status = 'cancelled',
            completed_at = ?,
            error = COALESCE(error, 'cancelled by user')
      WHERE id = ?`,
  )
    .bind(now, scanId)
    .run();

  return NextResponse.json({
    ok: true,
    scan_id: scanId,
    machine_destroyed: !!scan.fly_machine_id && !destroyError,
    machine_destroy_error: destroyError,
  });
}
