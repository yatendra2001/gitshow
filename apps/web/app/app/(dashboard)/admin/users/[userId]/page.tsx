import Link from "next/link";
import { notFound } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  ArrowUpRight01Icon,
  ViewIcon,
  PencilEdit01Icon,
} from "@hugeicons/core-free-icons";
import { Icon } from "@/components/dashboard/icon";
import {
  getAdminUserDetail,
  listScansByUser,
  type AdminScanRow,
  type AdminUserDetail,
} from "@/lib/admin-queries";
import { loadDraftResume, loadPublishedResume } from "@/lib/resume-io";
import { AdminActionButton } from "../../_actions";
import {
  AdminBackLink,
  AdminCard,
  HandleAvatar,
  StatusPill,
  TimeStamp,
  durationLabel,
  planKindFor,
  scanStatusKind,
} from "../../_components";
import { cn } from "@/lib/utils";

/**
 * /app/admin/users/[userId] — single-user detail page.
 *
 * Three columns of context:
 *   1. Identity card (login, email, avatar, GitHub OAuth scope, account
 *      created).
 *   2. Profile state — handle, public_slug, draft/published pointers,
 *      view count, custom domain.
 *   3. Subscription card — plan label, period_end, etc.
 *
 * Followed by:
 *   - Scan history (every scan, status, current_phase, duration, error
 *     preview, link to full event log).
 *
 * Draft preview lives in `/preview` sub-route (linked via the "Open
 * draft preview" CTA) — it renders the actual template at full bleed
 * so the operator can see what the user's draft looks like before they
 * publish.
 */

export const dynamic = "force-dynamic";

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  const { env } = await getCloudflareContext({ async: true });

  // Per-fetch try/catch so a single bad query (or a corrupt R2 object)
  // doesn't 500 the whole page and leave the operator with no signal.
  // The card-level renderers below tolerate nulls gracefully — they
  // already had to, because half the data is genuinely optional. The
  // banner renders a compact red diag block at the top whenever any
  // of these failed so we don't silently hide a regression.
  const [userResult, scansResult] = await Promise.all([
    safeAwait(() => getAdminUserDetail(env.DB, userId), "getAdminUserDetail"),
    safeAwait(() => listScansByUser(env.DB, userId, 50), "listScansByUser"),
  ]);

  if (userResult.kind === "ok" && !userResult.value) notFound();

  const user =
    userResult.kind === "ok"
      ? (userResult.value as AdminUserDetail)
      : null;
  const scans =
    scansResult.kind === "ok" ? (scansResult.value as AdminScanRow[]) : [];

  const handleForR2 = user ? (user.handle ?? user.login ?? null) : null;
  const draftResult = handleForR2
    ? await safeAwait(
        () => loadDraftResume(env.BUCKET, handleForR2),
        "loadDraftResume",
      )
    : { kind: "ok" as const, value: null };
  const publishedResult = handleForR2
    ? await safeAwait(
        () => loadPublishedResume(env.BUCKET, handleForR2),
        "loadPublishedResume",
      )
    : { kind: "ok" as const, value: null };
  const draft =
    draftResult.kind === "ok" ? draftResult.value : null;
  const published =
    publishedResult.kind === "ok" ? publishedResult.value : null;

  const errors: Array<{ source: string; message: string }> = [];
  for (const r of [userResult, scansResult, draftResult, publishedResult]) {
    if (r.kind === "err") errors.push(r);
  }

  if (!user) {
    return (
      <>
        <div className="mb-3">
          <AdminBackLink href="/app/admin/users" label="All users" />
        </div>
        <FailureBanner errors={errors} userId={userId} />
      </>
    );
  }

  const plan = planKindFor({
    status: user.subscription_status,
    periodEnd: user.subscription_period_end,
  });

  return (
    <>
      <div className="mb-3">
        <AdminBackLink href="/app/admin/users" label="All users" />
      </div>
      <header className="mb-6 flex items-center gap-4">
        <HandleAvatar url={user.image} login={user.login} size={56} />
        <div className="min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h1 className="text-[26px] font-semibold leading-none tracking-tight">
              @{user.login ?? user.handle ?? "unknown"}
            </h1>
            <StatusPill kind={plan.kind} label={plan.label} />
          </div>
          <div className="mt-2 text-[12.5px] text-muted-foreground">
            {user.name ?? "—"}
            {user.email ? <> · {user.email}</> : null}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {user.public_slug && user.current_profile_r2_key ? (
            <a
              href={`/${user.public_slug}`}
              target="_blank"
              rel="noreferrer"
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-lg border border-border/50 bg-card/60 px-3",
                "text-[12.5px] font-medium",
                "transition-[background-color,border-color] duration-[140ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
                "hover:bg-card hover:border-border/70",
              )}
            >
              <Icon icon={ViewIcon} className="size-3.5" />
              Live profile
              <Icon icon={ArrowUpRight01Icon} className="size-3" />
            </a>
          ) : null}
          {(draft || published) && handleForR2 ? (
            <Link
              href={`/app/admin-preview/${user.user_id}`}
              target="_blank"
              rel="noreferrer"
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-lg bg-foreground px-3",
                "text-[12.5px] font-medium text-background",
                "transition-opacity duration-[140ms] ease-[cubic-bezier(0.215,0.61,0.355,1)]",
                "hover:opacity-90 active:scale-[0.98]",
              )}
            >
              <Icon icon={PencilEdit01Icon} className="size-3.5" />
              Open {draft ? "draft" : "published"} preview
            </Link>
          ) : null}
          <AdminActionButton
            endpoint={`/api/admin/users/${user.user_id}/rerun`}
            label="Rerun scan"
            busyLabel="Spawning…"
            variant="primary"
            confirmText={`Rerun scan for @${user.login ?? user.handle ?? user.user_id}? Any in-flight scan will be force-cancelled.`}
            successMessage={(j) => {
              const data = j as { scan_id?: string } | null;
              return data?.scan_id ? `Spawned ${data.scan_id}` : "Spawned new scan";
            }}
          />
        </div>
      </header>

      {errors.length > 0 ? <FailureBanner errors={errors} userId={userId} /> : null}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3 mb-3">
        <IdentityCard user={user} />
        <ProfileCard user={user} hasDraft={Boolean(draft)} hasPublished={Boolean(published)} />
        <PlanCard user={user} />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3 mb-6">
        <DraftSummaryCard
          handle={handleForR2}
          hasDraft={Boolean(draft)}
          hasPublished={Boolean(published)}
          draftSummary={draftSummary(draft)}
          publishedSummary={draftSummary(published)}
        />
        <DomainCard user={user} />
        <ScanCountsCard scans={scans} />
      </div>

      <ScanHistory scans={scans} />
    </>
  );
}

function IdentityCard({ user }: { user: AdminUserDetail }) {
  return (
    <AdminCard title="Identity" subtitle="Login, account, OAuth">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[12.5px]">
        <Row label="user_id" value={<code className="font-mono text-[11.5px]">{user.user_id}</code>} />
        <Row label="login" value={user.login ? <code className="font-mono">@{user.login}</code> : "—"} />
        <Row label="email" value={user.email ?? "—"} />
        <Row label="created" value={<TimeStamp ts={user.created_at} />} />
        <Row
          label="github acct"
          value={
            user.github_account_id ? (
              <a
                href={`https://github.com/${user.login ?? ""}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[11.5px] hover:underline underline-offset-2"
              >
                {user.github_account_id}
                <Icon icon={ArrowUpRight01Icon} className="ml-0.5 inline size-3" />
              </a>
            ) : (
              "—"
            )
          }
        />
        <Row
          label="scope"
          value={
            user.github_scope ? (
              <code className="font-mono text-[11px] text-muted-foreground">
                {user.github_scope}
              </code>
            ) : (
              "—"
            )
          }
        />
      </dl>
    </AdminCard>
  );
}

function ProfileCard({
  user,
  hasDraft,
  hasPublished,
}: {
  user: AdminUserDetail;
  hasDraft: boolean;
  hasPublished: boolean;
}) {
  return (
    <AdminCard title="Profile" subtitle="Handle, slug, R2 pointers">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[12.5px]">
        <Row label="handle" value={user.handle ? <code className="font-mono">{user.handle}</code> : "—"} />
        <Row
          label="slug"
          value={
            user.public_slug ? (
              <a
                href={`/${user.public_slug}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono hover:underline underline-offset-2"
              >
                /{user.public_slug}
                <Icon icon={ArrowUpRight01Icon} className="ml-0.5 inline size-3" />
              </a>
            ) : (
              "—"
            )
          }
        />
        <Row
          label="published"
          value={
            hasPublished ? (
              <StatusPill kind="published" label="Live" />
            ) : (
              <StatusPill kind="neutral" label="Not public" />
            )
          }
        />
        <Row
          label="draft"
          value={
            hasDraft ? (
              <StatusPill kind="draft" label="Draft saved" />
            ) : (
              <StatusPill kind="neutral" label="No draft" />
            )
          }
        />
        <Row
          label="views"
          value={
            <span className="tabular-nums">
              {(user.view_count ?? 0).toLocaleString()}
            </span>
          }
        />
        <Row label="revisions" value={user.revision_count ?? 0} />
        <Row label="first scan" value={<TimeStamp ts={user.first_scan_at} />} />
        <Row label="last scan" value={<TimeStamp ts={user.last_scan_at} />} />
      </dl>
    </AdminCard>
  );
}

function PlanCard({ user }: { user: AdminUserDetail }) {
  const plan = planKindFor({
    status: user.subscription_status,
    periodEnd: user.subscription_period_end,
  });
  return (
    <AdminCard title="Subscription" subtitle="Dodo Payments mirror">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[12.5px]">
        <Row
          label="plan"
          value={<StatusPill kind={plan.kind} label={plan.label} />}
        />
        <Row label="status" value={user.subscription_status ?? "—"} />
        <Row label="interval" value={user.subscription_interval ?? "—"} />
        <Row
          label="amount"
          value={
            user.subscription_amount_cents != null
              ? formatMoney(user.subscription_amount_cents, user.subscription_currency)
              : "—"
          }
        />
        <Row
          label="period end"
          value={<TimeStamp ts={user.subscription_period_end} />}
        />
        <Row
          label="cancelling"
          value={user.cancel_at_period_end ? "Yes (at period end)" : "No"}
        />
        <Row
          label="sub_id"
          value={
            user.subscription_id ? (
              <code className="font-mono text-[11.5px]">
                {user.subscription_id}
              </code>
            ) : (
              "—"
            )
          }
        />
      </dl>
    </AdminCard>
  );
}

function DomainCard({ user }: { user: AdminUserDetail }) {
  return (
    <AdminCard title="Custom domain" subtitle="If the user attached one">
      {user.custom_hostname ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[12.5px]">
          <Row
            label="hostname"
            value={
              <a
                href={`https://${user.custom_hostname}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono hover:underline underline-offset-2"
              >
                {user.custom_hostname}
                <Icon icon={ArrowUpRight01Icon} className="ml-0.5 inline size-3" />
              </a>
            }
          />
          <Row label="status" value={user.custom_domain_status ?? "—"} />
        </dl>
      ) : (
        <p className="text-[12.5px] text-muted-foreground">No custom domain.</p>
      )}
    </AdminCard>
  );
}

function ScanCountsCard({ scans }: { scans: AdminScanRow[] }) {
  const total = scans.length;
  const failed = scans.filter((s) => s.status === "failed").length;
  const running = scans.filter(
    (s) => s.status === "running" || s.status === "queued",
  ).length;
  return (
    <AdminCard title="Scan totals" subtitle="Across this user's history">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[12.5px]">
        <Row label="total" value={<span className="tabular-nums">{total}</span>} />
        <Row label="running" value={<span className="tabular-nums">{running}</span>} />
        <Row label="failed" value={<span className="tabular-nums">{failed}</span>} />
        <Row
          label="last status"
          value={
            scans[0] ? (
              <StatusPill
                kind={scanStatusKind(scans[0].status)}
                label={scans[0].status}
              />
            ) : (
              "—"
            )
          }
        />
      </dl>
    </AdminCard>
  );
}

function DraftSummaryCard({
  handle,
  hasDraft,
  hasPublished,
  draftSummary,
  publishedSummary,
}: {
  handle: string | null;
  hasDraft: boolean;
  hasPublished: boolean;
  draftSummary: string;
  publishedSummary: string;
}) {
  return (
    <AdminCard title="Resume blob" subtitle="R2 storage state">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[12.5px]">
        <Row
          label="draft"
          value={
            hasDraft ? (
              <span>
                <StatusPill kind="draft" label="Saved" />
                <span className="ml-2 text-muted-foreground">{draftSummary}</span>
              </span>
            ) : (
              "—"
            )
          }
        />
        <Row
          label="published"
          value={
            hasPublished ? (
              <span>
                <StatusPill kind="published" label="Live" />
                <span className="ml-2 text-muted-foreground">
                  {publishedSummary}
                </span>
              </span>
            ) : (
              "—"
            )
          }
        />
        {handle ? (
          <>
            <Row
              label="draft key"
              value={
                <code className="font-mono text-[10.5px] text-muted-foreground break-all">
                  resumes/{handle.toLowerCase()}/draft.json
                </code>
              }
            />
            <Row
              label="published key"
              value={
                <code className="font-mono text-[10.5px] text-muted-foreground break-all">
                  resumes/{handle.toLowerCase()}/published.json
                </code>
              }
            />
          </>
        ) : null}
      </dl>
    </AdminCard>
  );
}

function ScanHistory({ scans }: { scans: AdminScanRow[] }) {
  return (
    <AdminCard
      title="Scan history"
      subtitle={`${scans.length} ${scans.length === 1 ? "run" : "runs"} on record`}
    >
      {scans.length === 0 ? (
        <p className="text-[12.5px] text-muted-foreground">No scans yet.</p>
      ) : (
        <ul className="divide-y divide-border/40">
          {scans.map((s) => (
            <ScanRow key={s.id} scan={s} />
          ))}
        </ul>
      )}
    </AdminCard>
  );
}

function ScanRow({ scan }: { scan: AdminScanRow }) {
  const dur = durationLabel(
    scan.created_at,
    scan.completed_at ?? scan.last_heartbeat,
  );
  return (
    <li className="py-2.5 first:pt-0 last:pb-0">
      <Link
        href={`/app/admin/scans/${scan.id}`}
        className={cn(
          "flex flex-col gap-1 -mx-2 px-2 py-1.5 rounded-lg",
          "transition-[background-color] duration-[120ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
          "hover:bg-foreground/[0.04]",
        )}
      >
        <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
          <StatusPill kind={scanStatusKind(scan.status)} label={scan.status} />
          <span className="text-foreground">
            {scan.current_phase ?? scan.last_completed_phase ?? "—"}
          </span>
          <span className="text-muted-foreground tabular-nums">· {dur}</span>
          <span className="text-muted-foreground tabular-nums">
            · {scan.llm_calls.toLocaleString()} llm calls
          </span>
          <span className="text-muted-foreground tabular-nums">
            · ${(scan.cost_cents / 100).toFixed(2)}
          </span>
          <span className="ml-auto text-[11px] text-muted-foreground">
            <TimeStamp ts={scan.created_at} />
          </span>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <code className="font-mono text-[10.5px]">{scan.id}</code>
          {scan.fly_machine_id ? (
            <span className="font-mono text-[10.5px]">
              · fly:{scan.fly_machine_id.slice(0, 12)}
            </span>
          ) : null}
        </div>
        {scan.error ? (
          <p className="mt-0.5 font-mono text-[11px] text-rose-500 line-clamp-2 leading-snug">
            {scan.error}
          </p>
        ) : null}
      </Link>
    </li>
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

function formatMoney(cents: number, currency: string | null): string {
  const c = (currency ?? "USD").toUpperCase();
  const value = cents / 100;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: c,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${c} ${value.toFixed(2)}`;
  }
}

function draftSummary(
  resume: Awaited<ReturnType<typeof loadDraftResume>>,
): string {
  if (!resume) return "—";
  const tpl = resume.theme?.template ?? "classic";
  const v = resume.meta?.version ?? "?";
  const updated = resume.meta?.updatedAt;
  const dt = updated ? new Date(updated).toLocaleDateString() : "?";
  return `${tpl} · v${v} · ${dt}`;
}

/**
 * Wrap an async data-fetch so it returns a discriminated union instead
 * of throwing. Lets the page surface partial success — if `subscription`
 * has a corrupt row, we still want to show the user's identity + scans
 * card and just flag the broken sub query at the top.
 */
type SafeResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "err"; source: string; message: string; stack?: string };

async function safeAwait<T>(
  fn: () => Promise<T>,
  source: string,
): Promise<SafeResult<T>> {
  try {
    return { kind: "ok", value: await fn() };
  } catch (err) {
    const e = err as Error;
    // Log to the Worker console so wrangler tail / observability picks
    // it up alongside the user-visible banner. Never re-throws —
    // operator surface absorbs the failure and renders what it can.
    console.error(`[admin] ${source} failed`, { source, error: e });
    return {
      kind: "err",
      source,
      message: (e?.message ?? String(err)).slice(0, 600),
      stack: e?.stack?.split("\n").slice(0, 4).join("\n"),
    };
  }
}

function FailureBanner({
  errors,
  userId,
}: {
  errors: Array<{ source: string; message: string; stack?: string }>;
  userId: string;
}) {
  return (
    <div className="mb-4 rounded-2xl border border-rose-500/30 bg-rose-500/[0.04] p-4">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <h3 className="text-[13px] font-semibold leading-tight tracking-tight text-rose-600 dark:text-rose-400">
          Partial load
        </h3>
        <code className="font-mono text-[10.5px] text-muted-foreground">
          user_id={userId}
        </code>
      </div>
      <ul className="space-y-2">
        {errors.map((err, i) => (
          <li key={`${err.source}-${i}`}>
            <div className="text-[11.5px] font-medium text-rose-600 dark:text-rose-400">
              {err.source}
            </div>
            <pre className="mt-0.5 whitespace-pre-wrap break-words font-mono text-[11px] leading-snug text-rose-700/90 dark:text-rose-400/80">
              {err.message}
              {err.stack ? `\n${err.stack}` : ""}
            </pre>
          </li>
        ))}
      </ul>
    </div>
  );
}
