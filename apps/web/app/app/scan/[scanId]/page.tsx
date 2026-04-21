import { notFound, redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getSession } from "@/auth";
import { ScanProgress } from "./_progress";

/**
 * /app/scan/{scanId} — live progress view for the authenticated user's
 * scan. Server-fetches the row once for initial paint + auth gate; the
 * client component polls `/api/scan/status/{scanId}` for updates.
 */

export const dynamic = "force-dynamic";

interface ScanRow {
  id: string;
  user_id: string;
  handle: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  current_phase: string | null;
  last_completed_phase: string | null;
  error: string | null;
  cost_cents: number;
  llm_calls: number;
  last_heartbeat: number | null;
  created_at: number;
  completed_at: number | null;
}

export default async function ScanProgressPage({
  params,
}: {
  params: Promise<{ scanId: string }>;
}) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/signin");

  const { scanId } = await params;
  const { env } = await getCloudflareContext({ async: true });

  const scan = await env.DB.prepare(
    `SELECT id, user_id, handle, status, current_phase, last_completed_phase,
            error, cost_cents, llm_calls, last_heartbeat, created_at, completed_at
       FROM scans WHERE id = ? AND user_id = ? LIMIT 1`,
  )
    .bind(scanId, session.user.id)
    .first<ScanRow>();

  if (!scan) notFound();

  return (
    <main className="min-h-svh bg-background text-foreground">
      <ScanProgress
        scanId={scanId}
        initial={{
          id: scan.id,
          handle: scan.handle,
          status: scan.status,
          current_phase: scan.current_phase,
          last_completed_phase: scan.last_completed_phase,
          error: scan.error,
          cost_usd: scan.cost_cents / 100,
          llm_calls: scan.llm_calls,
          last_heartbeat: scan.last_heartbeat,
          created_at: scan.created_at,
          completed_at: scan.completed_at,
        }}
      />
    </main>
  );
}
