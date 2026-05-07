import Link from "next/link";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  getAdminOverview,
  listAdminUsers,
  listRecentIssues,
} from "@/lib/admin-queries";
import {
  AdminCard,
  HandleAvatar,
  StatCard,
  StatusPill,
  TimeStamp,
  planKindFor,
  profileStatusFor,
  scanStatusKind,
} from "./_components";
import { AdminSubnav } from "./_subnav";
import { cn } from "@/lib/utils";

/**
 * /app/admin — operator overview.
 *
 * Three blocks:
 *   1. Hero stats (total users, published, scanning, recent failures).
 *   2. Latest signups + scans (so the operator can spot an in-progress
 *      onboarding without needing to navigate to /users).
 *   3. Recent issues feed (errors + stage-warns across every scan).
 */

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  const { env } = await getCloudflareContext({ async: true });
  const db = env.DB;
  const [overview, recent, issues] = await Promise.all([
    getAdminOverview(db),
    listAdminUsers(db, { limit: 8 }),
    listRecentIssues(db, 8),
  ]);

  return (
    <>
      <header className="mb-6">
        <div className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70 mb-2">
          Operator
        </div>
        <h1 className="text-[28px] sm:text-[32px] font-semibold leading-none tracking-tight">
          Admin
        </h1>
        <p className="mt-2 text-[12.5px] text-muted-foreground">
          Cross-user view of every profile, scan, and pipeline error.
        </p>
      </header>

      <AdminSubnav />

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-3 gs-enter">
        <StatCard
          label="Users"
          value={overview.total_users}
          hint={`${overview.recent_signups_24h} new in 24h`}
        />
        <StatCard
          label="Published"
          value={overview.published_users}
          hint={`${overview.draft_only_users} draft-only`}
        />
        <StatCard
          label="Scanning now"
          value={overview.scanning_users}
          hint={`${overview.total_scans.toLocaleString()} scans total`}
        />
        <StatCard
          label="Failed scans"
          value={overview.failed_scans_24h}
          hint={`${overview.failed_scans_7d} last 7d`}
        />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-6 gs-enter">
        <StatCard label="Pro subscribers" value={overview.pro_users} />
        <StatCard label="Total profile views" value={overview.total_views} />
      </div>

      {/* Recent users */}
      <div className="mb-3">
        <AdminCard
          title="Recent activity"
          subtitle="Latest signups and scans across all users"
          action={
            <Link
              href="/app/admin/users"
              className="text-[11.5px] font-medium text-muted-foreground hover:text-foreground"
            >
              View all →
            </Link>
          }
        >
          {recent.length === 0 ? (
            <EmptyRow label="No users yet." />
          ) : (
            <ul className="divide-y divide-border/40">
              {recent.map((u) => {
                const status = profileStatusFor({
                  isPublished: u.is_published === 1,
                  hasScan: Boolean(u.latest_scan_id),
                  scanStatus: u.latest_scan_status,
                });
                const plan = planKindFor({
                  status: u.subscription_status,
                  periodEnd: u.subscription_period_end,
                });
                const ts = u.latest_scan_created_at ?? u.created_at;
                return (
                  <li key={u.user_id} className="py-2.5 first:pt-0 last:pb-0">
                    <Link
                      href={`/app/admin/users/${u.user_id}`}
                      className={cn(
                        "flex items-center gap-3 -mx-2 px-2 py-1.5 rounded-lg",
                        "transition-[background-color] duration-[120ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
                        "hover:bg-foreground/[0.04]",
                      )}
                    >
                      <HandleAvatar url={u.image} login={u.login} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-[13px]">
                          <span className="truncate font-medium">
                            @{u.login ?? u.handle ?? "unknown"}
                          </span>
                          {u.name ? (
                            <span className="truncate text-muted-foreground/80 text-[11.5px]">
                              · {u.name}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                          <StatusPill kind={status.kind} label={status.label} />
                          <StatusPill kind={plan.kind} label={plan.label} />
                          <span className="hidden sm:inline">·</span>
                          <span className="hidden sm:inline">
                            <TimeStamp ts={ts} />
                          </span>
                        </div>
                      </div>
                      <span className="text-muted-foreground/70 text-[12px] shrink-0">
                        →
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </AdminCard>
      </div>

      {/* Recent issues */}
      <AdminCard
        title="Recent issues"
        subtitle="Pipeline errors + stage warnings, newest first"
      >
        {issues.length === 0 ? (
          <EmptyRow label="Nothing exploded recently 🟢" />
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
                  <div className="mt-1.5 size-1.5 shrink-0 rounded-full bg-rose-500" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[12.5px]">
                      <span className="font-medium">@{iss.user_login ?? iss.handle}</span>
                      <span className="text-muted-foreground/80">
                        {iss.stage ?? iss.worker ?? "scan"}
                      </span>
                      <span className="text-muted-foreground/60 text-[11px]">
                        {iss.kind === "error" ? "ERROR" : "WARN"}
                      </span>
                      <span className="ml-auto text-[11px] text-muted-foreground">
                        <TimeStamp ts={iss.at} />
                      </span>
                    </div>
                    {iss.message ? (
                      <p className="mt-0.5 text-[12px] text-muted-foreground line-clamp-2 font-mono leading-snug">
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

function EmptyRow({ label }: { label: string }) {
  return (
    <p className="text-[12.5px] text-muted-foreground py-2">{label}</p>
  );
}
