import Link from "next/link";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { listRecentIssues } from "@/lib/admin-queries";
import {
  AdminCard,
  StatusPill,
  TimeStamp,
  scanStatusKind,
} from "../_components";
import { AdminSubnav } from "../_subnav";
import { cn } from "@/lib/utils";

/**
 * /app/admin/issues — cross-user error feed.
 *
 * Pulls every `error` and `stage-warn` from `scan_events` regardless of
 * user. Click into any row to drop into that scan's full event log.
 *
 * Ordered newest-first; capped at 200 rows so the page stays snappy.
 */

export const dynamic = "force-dynamic";

export default async function AdminIssuesPage() {
  const { env } = await getCloudflareContext({ async: true });
  const issues = await listRecentIssues(env.DB, 200);

  return (
    <>
      <header className="mb-6">
        <div className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70 mb-2">
          Operator
        </div>
        <h1 className="text-[28px] sm:text-[32px] font-semibold leading-none tracking-tight">
          Issues
        </h1>
        <p className="mt-2 text-[12.5px] text-muted-foreground">
          Pipeline errors and warnings, newest first. Cross-user.
        </p>
      </header>

      <AdminSubnav />

      <AdminCard
        subtitle={`${issues.length.toLocaleString()} ${issues.length === 1 ? "event" : "events"}`}
      >
        {issues.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">
            No errors or warnings logged.
          </p>
        ) : (
          <ul className="divide-y divide-border/40">
            {issues.map((iss, i) => (
              <li
                key={`${iss.scan_id}-${iss.at}-${i}`}
                className="py-2.5 first:pt-0 last:pb-0"
              >
                <Link
                  href={`/app/admin/scans/${iss.scan_id}`}
                  className={cn(
                    "flex items-start gap-3 -mx-2 px-2 py-1.5 rounded-lg",
                    "transition-[background-color] duration-[120ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
                    "hover:bg-foreground/[0.04]",
                  )}
                >
                  <div
                    className={cn(
                      "mt-1.5 size-1.5 shrink-0 rounded-full",
                      iss.kind === "error" ? "bg-rose-500" : "bg-amber-500",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[12.5px]">
                      <span className="font-medium">@{iss.user_login ?? iss.handle}</span>
                      <span className="text-muted-foreground">
                        {iss.stage ?? iss.worker ?? "—"}
                      </span>
                      <StatusPill
                        kind={iss.kind === "error" ? "failed" : "queued"}
                        label={iss.kind === "error" ? "ERROR" : "WARN"}
                      />
                      <StatusPill
                        kind={scanStatusKind(iss.scan_status)}
                        label={`scan ${iss.scan_status}`}
                      />
                      <span className="ml-auto text-[11px] text-muted-foreground">
                        <TimeStamp ts={iss.at} />
                      </span>
                    </div>
                    {iss.message ? (
                      <p className="mt-0.5 text-[12px] text-muted-foreground line-clamp-2 font-mono leading-snug whitespace-pre-wrap">
                        {iss.message}
                      </p>
                    ) : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </AdminCard>
    </>
  );
}
