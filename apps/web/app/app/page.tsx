import Link from "next/link";
import { redirect } from "next/navigation";
import { Check, ExternalLink, Lock, Users, GitPullRequest } from "lucide-react";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getSession } from "@/auth";
import { NotificationBell } from "@/components/notifications/bell";
import { PushEnableButton } from "@/components/notifications/push-enable";
import { Logo } from "@/components/logo";
import {
  loadDraftResume,
  loadPublishedResume,
} from "@/lib/resume-io";
import { getSubscription, isActive } from "@/lib/entitlements";
import { StartFirstScanButton } from "./_start-button";
import { DeleteProfileButton } from "./_delete-profile-button";
import { SignOutButton } from "./_signout-button";
import { PublishDraftButton } from "./_publish-draft-button";
import { CheckoutProcessingAutoRefresh } from "./_checkout-processing";
import {
  AccessStateCard,
  type AccessState,
  type DataSources,
} from "@/components/scan/access-state-card";
import { LinkedInUploadCard } from "@/components/app/linkedin-upload-card";

/**
 * /app — the authenticated home. Single-person model.
 *
 * States (resume pipeline era):
 *   - No scan ever → "Get started" CTA → /api/intake flow
 *   - Scan running/queued → "Working on it" + email-when-ready copy
 *   - Scan succeeded, draft exists, nothing published → "Review draft" +
 *     "Publish" action (calls /api/profile/publish-resume)
 *   - Published → "Live at /{handle}" + Refresh / Delete
 *   - Scan failed → "Try again" with the error
 */

export const dynamic = "force-dynamic";

interface ScanSlim {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  handle: string;
  current_phase: string | null;
  error: string | null;
  created_at: number;
  completed_at: number | null;
  access_state: string | null;
  data_sources: string | null;
}

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

interface ProfileRow {
  handle: string;
  public_slug: string;
  last_scan_at: number | null;
  view_count: number | null;
}

export default async function AppHomePage({
  searchParams,
}: {
  searchParams?: Promise<{ checkout?: string | string[] }>;
}) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/signin");
  const userId = session.user.id;
  const githubHandle = (session.user.login ?? session.user.name ?? "").trim();

  const sp = (await searchParams) ?? {};
  const checkoutParam = Array.isArray(sp.checkout) ? sp.checkout[0] : sp.checkout;
  const justCheckedOut = checkoutParam === "success";

  const { env } = await getCloudflareContext({ async: true });

  // Gate: non-Pro users land on the showcase state with the upgrade
  // CTA. /app/billing stays accessible for cancelled users (via the
  // Billing link in the header), but everything else on /app is Pro.
  // Middleware additionally blocks deep /app/* routes (scan, edit,
  // preview, intake) so there's no back-door past this page.
  const subscription = await getSubscription(env.DB, userId);
  const isPro = isActive(subscription);

  // For non-Pro users we still want to show them their already-
  // published profile (read-only) if one exists — that's the
  // "cancelled user keeps their artifact" promise from the plan.
  const publishedResumeNonPro =
    !isPro && githubHandle
      ? await loadPublishedResume(env.BUCKET, githubHandle)
      : null;
  if (!isPro) {
    return (
      <main className="min-h-svh bg-background text-foreground">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-border/30 bg-background/80 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-3">
            <Logo href="/" size={24} />
            <span className="hidden sm:inline font-mono text-[11px] text-muted-foreground">
              @{githubHandle || "you"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/app/billing"
              className="rounded-lg border border-border/60 bg-card/30 px-3 py-1.5 text-[12px] hover:bg-card/50"
            >
              Billing
            </Link>
            <SignOutButton />
          </div>
        </header>
        {justCheckedOut ? (
          <CheckoutProcessingState />
        ) : (
          <NonProShowcase
            handle={githubHandle}
            hasPublished={Boolean(publishedResumeNonPro)}
            wasCancelled={subscription?.status === "cancelled"}
          />
        )}
      </main>
    );
  }

  const [profileRow, latestScan, activeScan] = await Promise.all([
    env.DB.prepare(
      `SELECT handle, public_slug, last_scan_at, view_count
         FROM user_profiles WHERE user_id = ? LIMIT 1`,
    )
      .bind(userId)
      .first<ProfileRow>(),
    env.DB.prepare(
      `SELECT id, status, handle, current_phase, error, created_at, completed_at,
              access_state, data_sources
         FROM scans WHERE user_id = ?
         ORDER BY created_at DESC LIMIT 1`,
    )
      .bind(userId)
      .first<ScanSlim>(),
    env.DB.prepare(
      `SELECT id, status, handle, current_phase, error, created_at, completed_at,
              access_state, data_sources
         FROM scans
         WHERE user_id = ? AND status IN ('queued','running')
         ORDER BY created_at DESC LIMIT 1`,
    )
      .bind(userId)
      .first<ScanSlim>(),
  ]);

  // Ground truth lives in R2. Checking D1 isn't enough — the
  // user_profiles row is optimistic; R2 can have a published.json even
  // if we haven't back-filled the row.
  const [publishedResume, draftResume] = await Promise.all([
    githubHandle ? loadPublishedResume(env.BUCKET, githubHandle) : null,
    githubHandle ? loadDraftResume(env.BUCKET, githubHandle) : null,
  ]);

  const hasPublished = Boolean(publishedResume);
  const hasDraft = Boolean(draftResume);
  const isScanning = Boolean(activeScan);

  const draftReady = hasDraft && !hasPublished && !isScanning;
  const lastFailed =
    latestScan?.status === "failed" && !activeScan && !hasPublished && !draftReady;

  const accessSnapshot = latestScan
    ? {
        accessState: safeParse<AccessState>(latestScan.access_state),
        dataSources: safeParse<DataSources>(latestScan.data_sources),
      }
    : null;

  return (
    <main className="min-h-svh bg-background text-foreground">
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-border/30 bg-background/80 px-4 backdrop-blur sm:px-6">
        <div className="flex items-center gap-3">
          <Logo href="/" size={24} />
          <span className="hidden sm:inline font-mono text-[11px] text-muted-foreground">
            @{githubHandle || "you"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <PushEnableButton />
          <NotificationBell />
          <Link
            href="/app/billing"
            className="rounded-lg border border-border/60 bg-card/30 px-3 py-1.5 text-[12px] hover:bg-card/50"
          >
            Billing
          </Link>
          <SignOutButton />
        </div>
      </header>

      {isScanning ? (
        <ScanningState scan={activeScan!} />
      ) : hasPublished ? (
        <PublishedState
          handle={githubHandle}
          slug={profileRow?.public_slug ?? githubHandle.toLowerCase()}
          lastScanAt={profileRow?.last_scan_at ?? null}
          viewCount={profileRow?.view_count ?? 0}
          access={accessSnapshot}
        />
      ) : draftReady ? (
        <DraftState
          handle={githubHandle}
          access={accessSnapshot}
          scanId={latestScan?.id ?? null}
          missingWorkOrEducation={
            (draftResume?.work?.length ?? 0) === 0 ||
            (draftResume?.education?.length ?? 0) === 0
          }
        />
      ) : lastFailed ? (
        <FailedState scan={latestScan!} />
      ) : (
        <EmptyState handle={githubHandle} />
      )}

      <footer className="mx-auto w-full max-w-3xl px-4 sm:px-6 pb-12 flex items-center justify-end gap-3 text-[11px] text-muted-foreground">
        <span className="font-mono">gitshow.io</span>
      </footer>
    </main>
  );
}

// ─── States ─────────────────────────────────────────────────────────

function EmptyState({ handle }: { handle: string }) {
  return (
    <section className="mx-auto w-full max-w-xl px-4 sm:px-6 py-16">
      <div className="text-[12px] uppercase tracking-wide text-muted-foreground/80 mb-2">
        Welcome
      </div>
      <h1 className="font-[var(--font-serif)] text-[32px] leading-tight mb-3">
        Build your portfolio
      </h1>
      <p className="text-[14px] leading-relaxed text-muted-foreground mb-6">
        We&apos;ll read your GitHub, ask a few quick questions, then run a full
        analysis. Close the tab whenever — we&apos;ll email you when
        it&apos;s live at{" "}
        <span className="font-mono">gitshow.io/{handle || "{handle}"}</span>.
      </p>

      <div className="mb-6 rounded-2xl border border-border/40 bg-card/30 p-4 flex flex-col gap-3">
        <div className="text-[12px] uppercase tracking-wide text-muted-foreground/80">
          What we&apos;ll look at
        </div>
        <ul className="flex flex-col gap-2.5">
          <ScopeRow
            icon={<GitPullRequest className="size-3.5" strokeWidth={2} />}
            title="Every repo you own + your org repos"
            body="Public, private, forks, archived — we sort which ones matter and study the top 15 deeply."
          />
          <ScopeRow
            icon={<Users className="size-3.5" strokeWidth={2} />}
            title="Drive-by contributions"
            body="PRs you shipped to other people's repos. One merged PR to facebook/react says more than 50 solo forks."
          />
          <ScopeRow
            icon={<Lock className="size-3.5" strokeWidth={2} />}
            title="Your private work, anonymised"
            body="We count private commits + reviews so your volume is accurate. Turn on the GitHub setting below and we can name the repos too."
          />
        </ul>
      </div>

      <div className="mb-7 rounded-2xl border border-dashed border-border/50 bg-card/20 p-4 flex flex-col gap-2">
        <div className="flex items-start gap-2.5">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted/40 mt-0.5">
            <Lock className="size-3.5 text-muted-foreground" strokeWidth={2.25} />
          </span>
          <div className="flex flex-col gap-1">
            <span className="text-[13px] font-medium">
              Two minutes that double what we see
            </span>
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              Flip{" "}
              <span className="text-foreground">
                Include private contributions on my profile
              </span>{" "}
              in GitHub settings before starting. We&apos;ll pull the full
              picture — org repos, private PRs, everything you&apos;ve
              shipped.
            </p>
          </div>
        </div>
        <a
          href="https://github.com/settings/profile#contributions-settings"
          target="_blank"
          rel="noreferrer"
          className="self-start inline-flex items-center gap-1 rounded-lg border border-border/60 bg-card/40 px-2.5 py-1 text-[11.5px] font-medium hover:bg-card/60"
        >
          Open GitHub setting
          <ExternalLink className="size-3" strokeWidth={2} />
        </a>
      </div>

      <StartFirstScanButton handle={handle} />
      <p className="mt-3 text-[11.5px] text-muted-foreground/80">
        Takes ~3–6 minutes. You&apos;ll review a draft before anything goes
        public.
      </p>
    </section>
  );
}

function ScopeRow({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted/40 text-muted-foreground mt-0.5">
        {icon}
      </span>
      <div className="flex flex-col gap-0.5">
        <span className="text-[13px] font-medium leading-snug">{title}</span>
        <span className="text-[12px] leading-relaxed text-muted-foreground">
          {body}
        </span>
      </div>
    </li>
  );
}

function ScanningState({ scan }: { scan: ScanSlim }) {
  const elapsedMin = Math.max(1, Math.round((Date.now() - scan.created_at) / 60000));
  return (
    <section className="mx-auto w-full max-w-xl px-4 sm:px-6 py-16">
      <div className="flex items-center gap-2 text-[12px] uppercase tracking-wide text-muted-foreground/80 mb-2">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--primary)] gs-pulse" />
        <span>Working on it</span>
      </div>
      <h1 className="font-[var(--font-serif)] text-[32px] leading-tight mb-3">
        Reading your code
      </h1>
      <p className="text-[14px] leading-relaxed text-muted-foreground mb-6">
        {scan.current_phase ? (
          <>
            Currently: <span className="text-foreground">{scan.current_phase}</span> · running for{" "}
            {elapsedMin} minute{elapsedMin === 1 ? "" : "s"}.
          </>
        ) : (
          <>Getting set up. The first update usually arrives within a minute.</>
        )}
        <br />
        You can close this tab — we&apos;ll email you when it&apos;s ready.
      </p>
      <div className="flex flex-wrap gap-2">
        <Link
          href={`/app/scan/${scan.id}`}
          className="inline-flex items-center rounded-xl bg-foreground text-background px-4 py-2 text-[13px] font-medium hover:opacity-90 transition-opacity min-h-11"
        >
          See live progress →
        </Link>
      </div>
    </section>
  );
}

function DraftState({
  handle,
  access,
  scanId,
  missingWorkOrEducation,
}: {
  handle: string;
  access: {
    accessState: AccessState | null;
    dataSources: DataSources | null;
  } | null;
  scanId: string | null;
  missingWorkOrEducation: boolean;
}) {
  const hasLocked =
    (access?.accessState?.orgs ?? []).some(
      (o) => o.state === "sso_required" || o.state === "oauth_restricted",
    );
  return (
    <section className="mx-auto w-full max-w-xl px-4 sm:px-6 py-16">
      <div className="text-[12px] uppercase tracking-wide text-muted-foreground/80 mb-2">
        Draft ready
      </div>
      <h1 className="font-[var(--font-serif)] text-[32px] leading-tight mb-3">
        Your portfolio is ready to review
      </h1>
      <p className="text-[14px] leading-relaxed text-muted-foreground mb-6">
        The scan for @{handle} finished. Preview it, and publish when it looks
        right — <span className="font-mono">gitshow.io/{handle}</span> goes
        live the moment you do.
      </p>
      <div className="flex flex-wrap gap-2 mb-6">
        <Link
          href="/app/preview"
          className="inline-flex items-center rounded-xl bg-foreground text-background px-4 py-2 text-[13px] font-medium hover:opacity-90 transition-opacity min-h-11"
        >
          Preview draft →
        </Link>
        <Link
          href="/app/edit"
          className="inline-flex items-center rounded-xl border border-border/60 bg-card/30 px-4 py-2 text-[13px] font-medium hover:bg-card/50 transition-colors min-h-11"
        >
          Edit
        </Link>
        <PublishDraftButton />
      </div>
      {access && (access.accessState || access.dataSources) ? (
        <div className="mt-4 border-t border-border/30 pt-5 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[13px] font-semibold">What we read</h2>
            {hasLocked ? (
              <span className="text-[11px] text-amber-600 dark:text-amber-400">
                Coverage tip below ↓
              </span>
            ) : null}
          </div>
          <AccessStateCard
            accessState={access.accessState}
            dataSources={access.dataSources}
          />
          {hasLocked ? (
            <p className="text-[11.5px] text-muted-foreground leading-relaxed">
              Authorize the locked orgs on GitHub, then re-run the scan before
              publishing if you want those repos included.
            </p>
          ) : null}
        </div>
      ) : null}
      {missingWorkOrEducation && scanId ? (
        <div className="mt-4 border-t border-border/30 pt-5">
          <LinkedInUploadCard scanId={scanId} />
        </div>
      ) : null}
    </section>
  );
}

function FailedState({ scan }: { scan: ScanSlim }) {
  return (
    <section className="mx-auto w-full max-w-xl px-4 sm:px-6 py-16">
      <div className="text-[12px] uppercase tracking-wide text-[var(--destructive)]/80 mb-2">
        Didn&apos;t finish
      </div>
      <h1 className="font-[var(--font-serif)] text-[32px] leading-tight mb-3">
        The last scan hit a snag
      </h1>
      {scan.error ? (
        <p className="mb-4 rounded-xl border border-border/40 bg-card/60 p-3 text-[12px] leading-relaxed text-muted-foreground">
          {scan.error.slice(0, 300)}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <StartFirstScanButton handle={scan.handle} label="Try again" />
      </div>
    </section>
  );
}

function PublishedState({
  handle,
  slug,
  lastScanAt,
  viewCount,
  access,
}: {
  handle: string;
  slug: string;
  lastScanAt: number | null;
  viewCount: number;
  access: {
    accessState: AccessState | null;
    dataSources: DataSources | null;
  } | null;
}) {
  const daysSinceScan = lastScanAt
    ? Math.floor((Date.now() - lastScanAt) / (1000 * 60 * 60 * 24))
    : null;
  const refreshedLabel =
    daysSinceScan === null
      ? null
      : daysSinceScan === 0
        ? "today"
        : daysSinceScan === 1
          ? "yesterday"
          : `${daysSinceScan} days ago`;

  return (
    <section className="mx-auto w-full max-w-xl px-4 sm:px-6 py-16">
      <div className="text-[12px] uppercase tracking-wide text-muted-foreground/80 mb-2">
        Live
      </div>
      <h1 className="font-[var(--font-serif)] text-[32px] leading-tight mb-3">
        Your portfolio is live
      </h1>
      <p className="text-[14px] leading-relaxed text-muted-foreground mb-4">
        Published at{" "}
        <Link
          href={`/${slug}`}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-foreground underline-offset-2 hover:underline"
        >
          gitshow.io/{handle}
        </Link>
        {refreshedLabel ? (
          <span className="text-muted-foreground/80"> · last refreshed {refreshedLabel}</span>
        ) : null}
        .
      </p>
      <div className="mb-7 inline-flex items-center gap-2 rounded-xl border border-border/40 bg-card/30 px-3 py-1.5 text-[12px] text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        <span>
          <span className="text-foreground font-medium tabular-nums">
            {viewCount.toLocaleString()}
          </span>{" "}
          {viewCount === 1 ? "view" : "views"}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link
          href={`/${slug}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center rounded-xl bg-foreground text-background px-4 py-2 text-[13px] font-medium hover:opacity-90 transition-opacity min-h-11"
        >
          View public portfolio ↗
        </Link>
        <Link
          href="/app/edit"
          className="inline-flex items-center rounded-xl border border-border/60 bg-card/30 px-4 py-2 text-[13px] font-medium hover:bg-card/50 transition-colors min-h-11"
        >
          Edit
        </Link>
      </div>

      <div className="mt-6 border-t border-border/30 pt-5">
        <div className="flex flex-col gap-2 text-[12px] text-muted-foreground">
          <span className="text-foreground font-medium">Delete profile</span>
          <span>
            Wipes scans and the public page. You&apos;ll start over from
            intake.
          </span>
          <DeleteProfileButton />
        </div>
      </div>
    </section>
  );
}

// ─── Post-checkout, pre-webhook ─────────────────────────────────────

function CheckoutProcessingState() {
  return (
    <section className="mx-auto w-full max-w-xl px-4 sm:px-6 py-16">
      <div className="text-[12px] uppercase tracking-wide text-muted-foreground/80 mb-2">
        Subscription
      </div>
      <h1 className="font-[var(--font-serif)] text-[32px] leading-tight mb-3">
        Finishing your subscription…
      </h1>
      <p className="text-[14px] leading-relaxed text-muted-foreground mb-2">
        Thanks for signing up. We&apos;re waiting on the final confirmation
        from the payment processor. Your dashboard will unlock
        automatically — no need to refresh.
      </p>
      <CheckoutProcessingAutoRefresh />
    </section>
  );
}

// ─── Non-Pro showcase ───────────────────────────────────────────────

const PRO_FEATURES = [
  "AI-generated portfolio from your GitHub history",
  "Unlimited regenerations and edits",
  "Private + org repos",
  "Custom domain",
  "Powerful analytics — see who viewed what",
  "Resume + PDF export",
] as const;

function NonProShowcase({
  handle,
  hasPublished,
  wasCancelled,
}: {
  handle: string;
  hasPublished: boolean;
  wasCancelled: boolean;
}) {
  return (
    <section className="mx-auto w-full max-w-xl px-4 sm:px-6 py-16">
      <div className="text-[12px] uppercase tracking-wide text-muted-foreground/80 mb-2">
        {wasCancelled ? "Welcome back" : "Upgrade to Pro"}
      </div>
      <h1 className="font-[var(--font-serif)] text-[32px] leading-tight mb-3">
        {wasCancelled
          ? "Your subscription ended"
          : "One plan unlocks everything"}
      </h1>
      <p className="text-[14px] leading-relaxed text-muted-foreground mb-6">
        {wasCancelled ? (
          <>
            Your Pro subscription ended. Your public profile{" "}
            <span className="font-mono">gitshow.io/{handle}</span>{" "}
            {hasPublished ? "stays live forever" : "was never published"} —
            subscribe again to regenerate, edit, or reconnect your domain.
          </>
        ) : (
          <>
            GitShow needs an active subscription to build, edit, or refresh
            a portfolio. $20/month, or $12/month billed annually.
          </>
        )}
      </p>

      <ul className="mb-7 grid grid-cols-1 gap-2 rounded-2xl border border-border/40 bg-card/30 p-5">
        {PRO_FEATURES.map((f) => (
          <li key={f} className="flex items-start gap-2 text-[13px]">
            <Check className="mt-0.5 size-4 shrink-0 text-[var(--primary)]" />
            <span className="text-secondary-foreground">{f}</span>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-2">
        <Link
          href="/pricing"
          className="inline-flex items-center rounded-xl bg-foreground text-background px-4 py-2 text-[13px] font-medium hover:opacity-90 transition-opacity min-h-11"
        >
          {wasCancelled ? "Re-subscribe →" : "See pricing →"}
        </Link>
        {hasPublished && handle ? (
          <Link
            href={`/${handle.toLowerCase()}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center rounded-xl border border-border/60 bg-card/30 px-4 py-2 text-[13px] font-medium hover:bg-card/50 transition-colors min-h-11"
          >
            View your live portfolio ↗
          </Link>
        ) : null}
      </div>
    </section>
  );
}
