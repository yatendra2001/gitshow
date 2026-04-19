import Link from "next/link";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { auth } from "@/auth";
import { formatDuration } from "@gitshow/shared/eta";
import { ArrowUpRight, Plus } from "lucide-react";

export const dynamic = "force-dynamic";

interface ScanRow {
  id: string;
  handle: string;
  status: string;
  current_phase: string | null;
  cost_cents: number;
  llm_calls: number;
  hiring_verdict: string | null;
  hiring_score: number | null;
  created_at: number;
  completed_at: number | null;
}

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const { env } = await getCloudflareContext({ async: true });

  let scans: ScanRow[] = [];
  try {
    const resp = await env.DB.prepare(
      `SELECT id, handle, status, current_phase, cost_cents, llm_calls,
              hiring_verdict, hiring_score, created_at, completed_at
         FROM scans
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT 50`,
    )
      .bind(session.user.id)
      .all<ScanRow>();
    scans = resp.results ?? [];
  } catch {
    // D1 not yet bound in local dev; render empty state.
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col px-6 py-12">
      <header className="mb-10 flex items-center justify-between">
        <div>
          <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            Signed in as @{session.user.name ?? "you"}
          </p>
          <h1 className="font-serif text-3xl tracking-tight">
            Your scans
          </h1>
        </div>
        <Link
          href="/s/new"
          className="inline-flex items-center gap-2 rounded-md bg-foreground px-4 py-2 text-xs font-semibold text-background transition hover:opacity-90"
        >
          <Plus className="size-3.5" />
          New scan
        </Link>
      </header>

      {scans.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="space-y-2">
          {scans.map((s) => (
            <ScanRow key={s.id} scan={s} />
          ))}
        </ul>
      )}
    </main>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-start gap-4 rounded-xl border border-border bg-card p-8">
      <h2 className="font-serif text-xl">No scans yet</h2>
      <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
        Start a scan by telling GitShow whose git history to read. First
        scans take 20–45 minutes; you'll see live progress as each
        pipeline stage completes.
      </p>
      <Link
        href="/s/new"
        className="inline-flex items-center gap-2 rounded-md bg-foreground px-4 py-2 text-xs font-semibold text-background"
      >
        Start your first scan
        <ArrowUpRight className="size-3.5" />
      </Link>
    </div>
  );
}

function ScanRow({ scan }: { scan: ScanRow }) {
  const elapsed = scan.completed_at
    ? scan.completed_at - scan.created_at
    : Date.now() - scan.created_at;
  const statusColor =
    scan.status === "succeeded"
      ? "text-[--color-gs-good-fg]"
      : scan.status === "failed"
        ? "text-destructive"
        : "text-[--color-gs-warn-fg]";
  return (
    <li className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3 transition hover:border-foreground/30">
      <Link
        href={`/s/${scan.id}`}
        className="flex flex-1 items-center gap-3 no-underline"
      >
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <span className="font-mono text-sm font-semibold">
              @{scan.handle}
            </span>
            <span
              className={`font-mono text-[10px] uppercase tracking-wider ${statusColor}`}
            >
              {scan.status}
            </span>
            {scan.current_phase && scan.status === "running" && (
              <span className="font-mono text-[10px] text-muted-foreground">
                · {scan.current_phase}
              </span>
            )}
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
            {new Date(scan.created_at).toLocaleString()} ·{" "}
            {formatDuration(elapsed)} ·{" "}
            ${(scan.cost_cents / 100).toFixed(2)} · {scan.llm_calls} LLM calls
            {scan.hiring_verdict &&
              ` · ${scan.hiring_verdict} (${scan.hiring_score ?? "—"})`}
          </div>
        </div>
        <ArrowUpRight className="size-4 text-muted-foreground" />
      </Link>
    </li>
  );
}
