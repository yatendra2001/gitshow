import Link from "next/link";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getSession } from "@/auth";
import { NotificationBell } from "@/components/notifications/bell";
import { PushEnableButton } from "@/components/notifications/push-enable";
import {
  loadDraftResume,
  loadPublishedResume,
} from "@/lib/resume-io";
import { StartFirstScanButton } from "./_start-button";
import { RefreshButton } from "./_refresh-button";
import { DeleteProfileButton } from "./_delete-profile-button";
import { DeleteAccountHandler } from "./_delete-handler";
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
}

export default async function AppHomePage() {
  const session = await getSession();
  if (!session?.user?.id) redirect("/signin");
  const userId = session.user.id;
  const githubHandle = (session.user.login ?? session.user.name ?? "").trim();

  const { env } = await getCloudflareContext({ async: true });

  const [profileRow, latestScan, activeScan] = await Promise.all([
    env.DB.prepare(
      `SELECT handle, public_slug, last_scan_at
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
          <span className="font-[var(--font-serif)] text-[18px] leading-none">
            gitshow
          </span>
          <span className="hidden sm:inline font-mono text-[11px] text-muted-foreground">
            @{githubHandle || "you"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <PushEnableButton />
          <NotificationBell />
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
        />
      ) : draftReady ? (
        <DraftState handle={githubHandle} />
      ) : lastFailed ? (
        <FailedState scan={latestScan!} />
      ) : (
        <EmptyState handle={githubHandle} />
      )}

      <footer className="mx-auto w-full max-w-3xl px-4 sm:px-6 pb-12 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
        <DeleteAccountHandler />
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
        <RefreshButton />
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
}: {
  handle: string;
  slug: string;
  lastScanAt: number | null;
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
      <p className="text-[14px] leading-relaxed text-muted-foreground mb-7">
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
        <RefreshButton />
      </div>

      <div className="mt-6 border-t border-border/30 pt-5">
        <div className="grid grid-cols-1 gap-4 text-[12px] text-muted-foreground sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <span className="text-foreground font-medium">Refresh</span>
            <span>
              Rescans your GitHub and regenerates the draft. Review and
              publish to update the live page.
            </span>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-foreground font-medium">Delete profile</span>
            <span>
              Wipes scans and the public page. You&apos;ll start over from
              intake.
            </span>
            <DeleteProfileButton />
          </div>
        </div>
      </div>
    </section>
  );
}
