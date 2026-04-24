import Link from "next/link";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { Check } from "lucide-react";
import { getSession } from "@/auth";
import { NotificationBell } from "@/components/notifications/bell";
import { PushEnableButton } from "@/components/notifications/push-enable";
import { Logo } from "@/components/logo";
import { getSubscription, isActive } from "@/lib/entitlements";
import {
  loadDraftResume,
  loadPublishedResume,
} from "@/lib/resume-io";
import { StartFirstScanButton } from "./_start-button";
import { DeleteProfileButton } from "./_delete-profile-button";
import { SignOutButton } from "./_signout-button";
import { PublishDraftButton } from "./_publish-draft-button";

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
}

interface ProfileRow {
  handle: string;
  public_slug: string;
  last_scan_at: number | null;
  view_count: number | null;
}

export default async function AppHomePage() {
  const session = await getSession();
  if (!session?.user?.id) redirect("/signin");
  const userId = session.user.id;
  const githubHandle = (session.user.login ?? session.user.name ?? "").trim();

  const { env } = await getCloudflareContext({ async: true });

  const subscription = await getSubscription(env.DB, userId);
  const isPro = isActive(subscription);

  // Non-Pro branch: lightweight showcase + CTA to /pricing. Keeps the
  // public profile link visible if they had one (cancellation leaves
  // /{handle} live forever), plus Billing for portal access.
  if (!isPro) {
    const publishedResumeNonPro = githubHandle
      ? await loadPublishedResume(env.BUCKET, githubHandle)
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
            <Link
              href="/app/billing"
              className="inline-flex items-center rounded-lg px-2.5 py-1.5 text-[12px] text-muted-foreground hover:text-foreground hover:bg-card/50 transition-colors"
            >
              Billing
            </Link>
            <SignOutButton />
          </div>
        </header>
        <NonProShowcase
          handle={githubHandle}
          hasPublished={Boolean(publishedResumeNonPro)}
          wasCancelled={subscription?.status === "cancelled"}
        />
        <footer className="mx-auto w-full max-w-3xl px-4 sm:px-6 pb-12 flex items-center justify-end gap-3 text-[11px] text-muted-foreground">
          <span className="font-mono">gitshow.io</span>
        </footer>
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
      `SELECT id, status, handle, current_phase, error, created_at, completed_at
         FROM scans WHERE user_id = ?
         ORDER BY created_at DESC LIMIT 1`,
    )
      .bind(userId)
      .first<ScanSlim>(),
    env.DB.prepare(
      `SELECT id, status, handle, current_phase, error, created_at, completed_at
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
            className="inline-flex items-center rounded-lg px-2.5 py-1.5 text-[12px] text-muted-foreground hover:text-foreground hover:bg-card/50 transition-colors"
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
        />
      ) : draftReady ? (
        <DraftState handle={githubHandle} />
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
        analysis. You can close the tab — we&apos;ll email you when it&apos;s ready
        at <span className="font-mono">gitshow.io/{handle || "{handle}"}</span>.
      </p>
      <StartFirstScanButton handle={handle} />
    </section>
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

function DraftState({ handle }: { handle: string }) {
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
      <div className="flex flex-wrap gap-2">
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
}: {
  handle: string;
  slug: string;
  lastScanAt: number | null;
  viewCount: number;
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

// ─── Non-Pro showcase ───────────────────────────────────────────────

const PRO_FEATURES = [
  "Full GitHub analysis across public + private repos",
  "AI-written portfolio highlighting your real work",
  "Public profile at gitshow.io/{handle} — shareable forever",
  "Per-section editor to refine the generated resume",
  "Monthly refresh scans to keep your profile current",
];

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
        {wasCancelled ? "Subscription ended" : "Welcome"}
      </div>
      <h1 className="font-[var(--font-serif)] text-[32px] leading-tight mb-3">
        {wasCancelled
          ? "Re-activate to edit your portfolio"
          : "Your portfolio starts with Pro"}
      </h1>
      <p className="text-[14px] leading-relaxed text-muted-foreground mb-6">
        {wasCancelled ? (
          <>
            Your public page at{" "}
            <span className="font-mono">gitshow.io/{handle}</span> stays
            live. Re-subscribe to run new scans, edit sections, and
            refresh your portfolio.
          </>
        ) : (
          <>
            GitShow runs a full AI analysis of your GitHub and ships a
            public portfolio at{" "}
            <span className="font-mono">
              gitshow.io/{handle || "{handle}"}
            </span>
            . One plan, everything included.
          </>
        )}
      </p>

      <ul className="mb-7 space-y-2 text-[13px] text-foreground/90">
        {PRO_FEATURES.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--primary)]" />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-2">
        <Link
          href="/pricing"
          className="inline-flex items-center rounded-xl bg-foreground text-background px-4 py-2 text-[13px] font-medium hover:opacity-90 transition-opacity min-h-11"
        >
          {wasCancelled ? "Re-subscribe →" : "See plans →"}
        </Link>
        {hasPublished && handle ? (
          <Link
            href={`/${handle}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center rounded-xl border border-border/60 bg-card/30 px-4 py-2 text-[13px] font-medium hover:bg-card/50 transition-colors min-h-11"
          >
            View public portfolio ↗
          </Link>
        ) : null}
      </div>
    </section>
  );
}
