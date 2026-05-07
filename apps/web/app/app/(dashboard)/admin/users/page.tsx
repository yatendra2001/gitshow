import Link from "next/link";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/dashboard/icon";
import { listAdminUsers, type AdminUserRow } from "@/lib/admin-queries";
import {
  AdminCard,
  HandleAvatar,
  StatusPill,
  TimeStamp,
  planKindFor,
  profileStatusFor,
} from "../_components";
import { AdminSubnav } from "../_subnav";
import { cn } from "@/lib/utils";

/**
 * /app/admin/users — every user, sortable by latest activity.
 *
 * Single fat row per user with the meaningful badges inline (status,
 * plan, view count, scan count) so the operator can scan top-down
 * without expanding rows. Click a row to dive into the detail view.
 *
 * Search is implemented via a server-side `?q=` param and a tiny GET
 * form — no client state, no debouncing complexity. The query LIKEs
 * across login/name/email/handle.
 */

export const dynamic = "force-dynamic";

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string | string[] }>;
}) {
  const sp = (await searchParams) ?? {};
  const qParam = Array.isArray(sp.q) ? sp.q[0] : sp.q;
  const q = (qParam ?? "").trim();

  const { env } = await getCloudflareContext({ async: true });
  const users = await listAdminUsers(env.DB, { search: q || undefined });

  return (
    <>
      <header className="mb-6">
        <div className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70 mb-2">
          Operator
        </div>
        <h1 className="text-[28px] sm:text-[32px] font-semibold leading-none tracking-tight">
          Users
        </h1>
        <p className="mt-2 text-[12.5px] text-muted-foreground">
          {users.length.toLocaleString()} {users.length === 1 ? "user" : "users"}
          {q ? <> matching <span className="font-mono text-foreground">{q}</span></> : null}
        </p>
      </header>

      <AdminSubnav />

      <form
        action="/app/admin/users"
        method="get"
        className="mb-4 flex items-center gap-2"
      >
        <input
          name="q"
          defaultValue={q}
          placeholder="Search login, name, email, or handle…"
          className={cn(
            "flex-1 max-w-md h-9 rounded-lg border border-border/50 bg-card/60 px-3 text-[12.5px]",
            "placeholder:text-muted-foreground/70",
            "outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:border-border",
          )}
        />
        {q ? (
          <Link
            href="/app/admin/users"
            className="text-[12px] text-muted-foreground hover:text-foreground"
          >
            Clear
          </Link>
        ) : null}
      </form>

      <AdminCard>
        {users.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground py-2">
            No users matched.
          </p>
        ) : (
          <ul className="divide-y divide-border/40">
            {users.map((u) => (
              <UserRow key={u.user_id} u={u} />
            ))}
          </ul>
        )}
      </AdminCard>
    </>
  );
}

function UserRow({ u }: { u: AdminUserRow }) {
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
    <li
      className={cn(
        "group relative flex items-center gap-3 -mx-2 px-2 py-2 rounded-lg",
        "transition-[background-color] duration-[120ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
        "hover:bg-foreground/[0.04]",
      )}
    >
      <HandleAvatar url={u.image} login={u.login} size={32} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[13px]">
          <span className="truncate font-medium">
            @{u.login ?? u.handle ?? "unknown"}
          </span>
          {u.email ? (
            <span className="truncate text-muted-foreground/70 text-[11.5px]">
              · {u.email}
            </span>
          ) : null}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <StatusPill kind={status.kind} label={status.label} />
          <StatusPill kind={plan.kind} label={plan.label} />
          <span className="tabular-nums">
            {u.total_scans} {u.total_scans === 1 ? "scan" : "scans"}
          </span>
          {u.failed_scans > 0 ? (
            <span className="tabular-nums text-rose-500">
              · {u.failed_scans} failed
            </span>
          ) : null}
          {u.view_count !== null && u.view_count > 0 ? (
            <span className="tabular-nums">
              · {u.view_count.toLocaleString()} views
            </span>
          ) : null}
          <span className="ml-auto">
            <TimeStamp ts={ts} />
          </span>
        </div>
      </div>
      {/* Stretched-link pattern: full-row Link sits behind the rest of
          the row (z-0), so the optional external-link icon below stays
          independently clickable (z-10). Avoids nesting <a> in <a>
          AND avoids passing onClick handlers to a server component. */}
      <Link
        href={`/app/admin/users/${u.user_id}`}
        aria-label={`Open user ${u.login ?? u.handle ?? ""}`}
        className="absolute inset-0 z-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      />
      {u.is_published === 1 && u.public_slug ? (
        <a
          href={`/${u.public_slug}`}
          target="_blank"
          rel="noreferrer"
          title={`View gitshow.io/${u.public_slug}`}
          className={cn(
            "relative z-10 shrink-0 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground",
            "transition-[background-color,color] duration-[120ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
            "hover:bg-foreground/[0.06] hover:text-foreground",
          )}
        >
          <Icon icon={ArrowUpRight01Icon} className="size-4" />
        </a>
      ) : null}
    </li>
  );
}
