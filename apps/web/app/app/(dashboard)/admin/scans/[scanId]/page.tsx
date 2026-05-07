import Link from "next/link";
import { notFound } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/dashboard/icon";
import {
  getAdminScan,
  listScanEvents,
  type AdminEventRow,
  type AdminScanRow,
} from "@/lib/admin-queries";
import {
  AdminBackLink,
  AdminCard,
  StatusPill,
  TimeStamp,
  durationLabel,
  scanStatusKind,
} from "../../_components";
import { cn } from "@/lib/utils";

/**
 * /app/admin/scans/[scanId] — full event log for a single scan.
 *
 * Shows the scan summary header (status, phase, error, cost, llm calls,
 * fly machine, runtime), then the chronological event log filtered by
 * a `?kind=` query param (default: errors + warns).
 *
 * The event log is rendered as a tight monospace strip — one row per
 * event — so the operator can scroll through hundreds of events
 * without the surface ballooning. We deliberately don't reconstruct
 * the reasoning/tool nesting the live progress page does; the goal
 * here is forensics, not UX.
 */

export const dynamic = "force-dynamic";

const KIND_FILTERS: Array<{
  key: string;
  label: string;
  kinds: string[] | null; // null = all
}> = [
  { key: "issues",  label: "Errors + warns", kinds: ["error", "stage-warn"] },
  { key: "phases",  label: "Phase boundaries", kinds: ["stage-start", "stage-end", "stage-warn", "error"] },
  { key: "agents",  label: "Agents",
    kinds: [
      "tool-start",
      "tool-end",
      "reasoning-delta",
      "reasoning-end",
      "agent-question",
      "agent-answer",
    ] },
  { key: "all",     label: "Everything",     kinds: null },
];

export default async function AdminScanLogPage({
  params,
  searchParams,
}: {
  params: Promise<{ scanId: string }>;
  searchParams?: Promise<{ kind?: string | string[] }>;
}) {
  const { scanId } = await params;
  const sp = (await searchParams) ?? {};
  const kindParam = Array.isArray(sp.kind) ? sp.kind[0] : sp.kind;
  const filter =
    KIND_FILTERS.find((f) => f.key === kindParam) ?? KIND_FILTERS[0]!;

  const { env } = await getCloudflareContext({ async: true });
  const [scan, events] = await Promise.all([
    getAdminScan(env.DB, scanId),
    listScanEvents(env.DB, scanId, 1000),
  ]);
  if (!scan) notFound();

  const filtered =
    filter.kinds === null
      ? events
      : events.filter((e) => filter.kinds!.includes(e.kind));

  return (
    <>
      <div className="mb-3">
        <AdminBackLink
          href={`/app/admin/users/${scan.user_id}`}
          label={`Back to @${scan.user_login ?? scan.handle}`}
        />
      </div>
      <header className="mb-6 flex flex-wrap items-baseline gap-3">
        <h1 className="text-[24px] font-semibold leading-none tracking-tight">
          Scan log
        </h1>
        <StatusPill kind={scanStatusKind(scan.status)} label={scan.status} />
        <span className="text-[12px] text-muted-foreground">
          for{" "}
          <Link
            href={`/app/admin/users/${scan.user_id}`}
            className="font-mono text-foreground hover:underline underline-offset-2"
          >
            @{scan.user_login ?? scan.handle}
          </Link>
        </span>
      </header>

      <ScanSummary scan={scan} eventCount={events.length} />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground/70">
          Filter
        </span>
        <div className="inline-flex items-center rounded-lg border border-border/50 bg-card/60 p-0.5">
          {KIND_FILTERS.map((f) => {
            const active = f.key === filter.key;
            return (
              <Link
                key={f.key}
                href={`/app/admin/scans/${scanId}?kind=${f.key}`}
                scroll={false}
                className={cn(
                  "px-3 py-1 text-[12px] font-medium rounded-md",
                  "transition-[color,transform] duration-[140ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
                  "active:scale-[0.97] active:duration-[80ms]",
                  active
                    ? "bg-background text-foreground shadow-[0_0_0_1px_oklch(from_var(--foreground)_l_c_h/0.08),0_1px_2px_-1px_oklch(0_0_0_/_0.06)]"
                    : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]",
                )}
              >
                {f.label}
              </Link>
            );
          })}
        </div>
        <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
          {filtered.length.toLocaleString()} of {events.length.toLocaleString()} events
        </span>
      </div>

      <AdminCard>
        {filtered.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground py-2">
            No events matched this filter.
          </p>
        ) : (
          <ol className="divide-y divide-border/40">
            {filtered.map((ev) => (
              <EventRowComp key={ev.id} ev={ev} />
            ))}
          </ol>
        )}
      </AdminCard>
    </>
  );
}

function ScanSummary({
  scan,
  eventCount,
}: {
  scan: AdminScanRow;
  eventCount: number;
}) {
  const dur = durationLabel(scan.created_at, scan.completed_at ?? scan.last_heartbeat);
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3 mb-6">
      <AdminCard title="Pipeline" subtitle="Phase + duration">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[12.5px]">
          <Row label="phase" value={scan.current_phase ?? scan.last_completed_phase ?? "—"} />
          <Row label="duration" value={<span className="tabular-nums">{dur}</span>} />
          <Row label="created" value={<TimeStamp ts={scan.created_at} />} />
          <Row label="completed" value={<TimeStamp ts={scan.completed_at} />} />
          <Row label="heartbeat" value={<TimeStamp ts={scan.last_heartbeat} />} />
        </dl>
      </AdminCard>
      <AdminCard title="Cost" subtitle="LLM spend on this scan">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[12.5px]">
          <Row label="llm calls" value={<span className="tabular-nums">{scan.llm_calls.toLocaleString()}</span>} />
          <Row label="cost" value={<span className="tabular-nums">${(scan.cost_cents / 100).toFixed(2)}</span>} />
          <Row label="events" value={<span className="tabular-nums">{eventCount.toLocaleString()}</span>} />
        </dl>
      </AdminCard>
      <AdminCard title="Runtime" subtitle="Worker placement">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[12.5px]">
          <Row
            label="fly machine"
            value={
              scan.fly_machine_id ? (
                <code className="font-mono text-[11.5px]">
                  {scan.fly_machine_id}
                </code>
              ) : (
                "—"
              )
            }
          />
          <Row
            label="scan_id"
            value={<code className="font-mono text-[11.5px]">{scan.id}</code>}
          />
          <Row
            label="user_id"
            value={
              <Link
                href={`/app/admin/users/${scan.user_id}`}
                className="font-mono text-[11.5px] hover:underline underline-offset-2"
              >
                {scan.user_id}
                <Icon icon={ArrowUpRight01Icon} className="ml-0.5 inline size-3" />
              </Link>
            }
          />
        </dl>
      </AdminCard>
      {scan.error ? (
        <AdminCard
          title="Terminal error"
          subtitle="What killed this run"
          className="lg:col-span-3 border-rose-500/30 bg-rose-500/[0.04]"
        >
          <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-snug text-rose-600 dark:text-rose-400">
            {scan.error}
          </pre>
        </AdminCard>
      ) : null}
    </div>
  );
}

function EventRowComp({ ev }: { ev: AdminEventRow }) {
  const tone = eventTone(ev.kind, ev.status);
  return (
    <li className="py-1.5 first:pt-0 last:pb-0 -mx-1 px-1 hover:bg-foreground/[0.03] rounded-md">
      <div className="flex flex-wrap items-baseline gap-2 text-[11.5px] leading-snug">
        <span className="font-mono tabular-nums text-muted-foreground/70 text-[10.5px] w-[72px] shrink-0">
          {fmtTime(ev.at)}
        </span>
        <span
          className={cn(
            "inline-flex items-center rounded-sm px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.04em]",
            tone,
          )}
        >
          {ev.kind}
        </span>
        {ev.stage ? (
          <span className="font-mono text-[10.5px] text-foreground/80">
            {ev.stage}
          </span>
        ) : null}
        {ev.worker ? (
          <span className="font-mono text-[10.5px] text-muted-foreground">
            {ev.worker}
          </span>
        ) : null}
        {ev.duration_ms != null ? (
          <span className="font-mono text-[10.5px] text-muted-foreground tabular-nums">
            {ev.duration_ms}ms
          </span>
        ) : null}
        {ev.status ? (
          <span className="font-mono text-[10.5px] text-muted-foreground">
            ({ev.status})
          </span>
        ) : null}
      </div>
      {ev.message ? (
        <p
          className={cn(
            "mt-0.5 ml-[80px] font-mono text-[11px] leading-snug whitespace-pre-wrap break-words",
            ev.kind === "error" ? "text-rose-500" : "text-muted-foreground",
          )}
        >
          {ev.message}
        </p>
      ) : null}
      {ev.data_json ? <DataJsonRow raw={ev.data_json} /> : null}
    </li>
  );
}

function DataJsonRow({ raw }: { raw: string }) {
  let pretty = raw;
  try {
    pretty = JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    /* leave as-is */
  }
  return (
    <details className="ml-[80px] mt-0.5">
      <summary className="cursor-pointer text-[10.5px] text-muted-foreground/70 hover:text-foreground select-none">
        data_json
      </summary>
      <pre className="mt-1 max-h-[280px] overflow-auto rounded-md border border-border/40 bg-foreground/[0.02] p-2 font-mono text-[10.5px] leading-snug text-muted-foreground">
        {pretty}
      </pre>
    </details>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <dt className="text-[10.5px] uppercase tracking-[0.06em] text-muted-foreground/70 self-center">
        {label}
      </dt>
      <dd className="text-foreground/90 break-words">{value}</dd>
    </>
  );
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function eventTone(kind: string, status: string | null): string {
  if (kind === "error") return "bg-rose-500/15 text-rose-600 dark:text-rose-400";
  if (kind === "stage-warn") return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
  if (kind === "stage-start" || kind === "tool-start") {
    return "bg-blue-500/12 text-blue-600 dark:text-blue-400";
  }
  if (kind === "stage-end" || kind === "tool-end") {
    if (status === "err") return "bg-rose-500/15 text-rose-600 dark:text-rose-400";
    return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
  }
  if (kind === "agent-question" || kind === "agent-answer") {
    return "bg-violet-500/12 text-violet-600 dark:text-violet-400";
  }
  return "bg-foreground/[0.06] text-muted-foreground";
}
