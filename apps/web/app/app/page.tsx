import Link from "next/link";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { auth } from "@/auth";
import { NotificationBell } from "@/components/notifications/bell";
import { PushEnableButton } from "@/components/notifications/push-enable";
import { getProfileBySlug } from "@/lib/profiles";
import { StartFirstScanButton } from "./_start-button";
import { RefreshButton } from "./_refresh-button";
import { DeleteProfileButton } from "./_delete-profile-button";
import { DeleteAccountHandler } from "./_delete-handler";

/**
 * /app — the authenticated home. Single-person model:
 *   - No scan → CTA to start the intake flow.
 *   - Scan running → link into the live /s/[id] progress view.
 *   - Scan succeeded + published → render the lean profile in place
 *     + Refresh / Delete affordances.
 *   - Scan succeeded but NOT published yet (draft) → show a preview
 *     of the draft card + "Review and publish" / "Refresh" actions.
 *     This covers the gap introduced by dropping auto-publish: a
 *     finished scan should always surface here instead of the raw
 *     "Let's build your profile" empty state.
 *   - Scan failed → show the last reason + "Try again".
 */

export const dynamic = "force-dynamic";

interface UserProfileRow {
  user_id: string;
  handle: string;
  public_slug: string;
  current_scan_id: string | null;
  current_profile_r2_key: string | null;
  last_scan_at: number | null;
}

interface ScanSlim {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  handle: string;
  current_phase: string | null;
  error: string | null;
  created_at: number;
  completed_at: number | null;
}

export default async function AppHomePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  const userId = session.user.id;
  // Prefer the GitHub login (username) captured in the signIn callback.
  // Fall back to display name only if login never made it into the row
  // (e.g. a sign-in from before migration 0005 landed).
  const githubHandle = (session.user.login ?? session.user.name ?? "").trim();

  const { env } = await getCloudflareContext({ async: true });

  const [profileRow, latestScan, activeScan] = await Promise.all([
    env.DB.prepare(
      `SELECT user_id, handle, public_slug, current_scan_id, current_profile_r2_key, last_scan_at
         FROM user_profiles WHERE user_id = ? LIMIT 1`,
    )
      .bind(userId)
      .first<UserProfileRow>(),
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

  // Render data for the lean card if the user has a succeeded profile.
  let cardData:
    | { row: UserProfileRow; card: import("@gitshow/shared/schemas").ProfileCard }
    | null = null;
  if (profileRow?.current_profile_r2_key) {
    cardData = await getProfileBySlug(env.DB, env.BUCKET, profileRow.public_slug);
  }

  const hasProfile = Boolean(cardData);
  const isScanning = Boolean(activeScan);
  // A "draft" is a succeeded scan the user hasn't published yet.
  // Post-PR#40 scan completion no longer auto-publishes, so /app must
  // land returning users on their draft — not on the fresh intake CTA.
  const draftScan =
    latestScan?.status === "succeeded" && !hasProfile ? latestScan : null;
  const lastFailed =
    latestScan?.status === "failed" && !activeScan && !hasProfile && !draftScan;

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
          <form action="/api/auth/signout" method="post">
            <button
              type="submit"
              className="text-[12px] text-muted-foreground hover:text-foreground transition-colors min-h-9 px-2"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      {isScanning ? (
        <ScanningState scan={activeScan!} />
      ) : hasProfile ? (
        <ProfileState
          handle={cardData!.row.handle}
          publicSlug={cardData!.row.public_slug}
          lastScanAt={cardData!.row.last_scan_at}
          currentScanId={cardData!.row.current_scan_id}
        />
      ) : draftScan ? (
        <DraftState scan={draftScan} />
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
        Build your profile
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
          href={`/s/${scan.id}`}
          className="inline-flex items-center rounded-xl bg-foreground text-background px-4 py-2 text-[13px] font-medium hover:opacity-90 transition-opacity min-h-11"
        >
          See progress →
        </Link>
      </div>
    </section>
  );
}

function DraftState({ scan }: { scan: ScanSlim }) {
  return (
    <section className="mx-auto w-full max-w-xl px-4 sm:px-6 py-16">
      <div className="text-[12px] uppercase tracking-wide text-muted-foreground/80 mb-2">
        Draft ready
      </div>
      <h1 className="font-[var(--font-serif)] text-[32px] leading-tight mb-3">
        Your profile is ready to review
      </h1>
      <p className="text-[14px] leading-relaxed text-muted-foreground mb-6">
        The scan for @{scan.handle} finished. Review the draft, edit anything
        that needs fixing, and publish when it&apos;s right —{" "}
        <span className="font-mono">gitshow.io/{scan.handle}</span> goes live
        the moment you do.
      </p>
      <div className="flex flex-wrap gap-2">
        <Link
          href={`/s/${scan.id}`}
          className="inline-flex items-center rounded-xl bg-foreground text-background px-4 py-2 text-[13px] font-medium hover:opacity-90 transition-opacity min-h-11"
        >
          Review and publish →
        </Link>
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

/**
 * Dashboard-only view. We used to render the full LeanProfileCard
 * inline here, but that duplicated the public /{handle} render and
 * turned /app into two copies of the same page. /app is the control
 * room: link out to the live profile, plus Edit / Refresh / Delete.
 */
function ProfileState({
  handle,
  publicSlug,
  lastScanAt,
  currentScanId,
}: {
  handle: string;
  publicSlug: string;
  lastScanAt: number | null;
  currentScanId: string | null;
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
        Your profile is live
      </h1>
      <p className="text-[14px] leading-relaxed text-muted-foreground mb-7">
        Published at{" "}
        <Link
          href={`/${publicSlug}`}
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
          href={`/${publicSlug}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center rounded-xl bg-foreground text-background px-4 py-2 text-[13px] font-medium hover:opacity-90 transition-opacity min-h-11"
        >
          View public profile ↗
        </Link>
        {currentScanId ? (
          <Link
            href={`/s/${currentScanId}`}
            className="inline-flex items-center rounded-xl border border-border/60 px-4 py-2 text-[13px] font-medium text-foreground hover:bg-card transition-colors min-h-11"
          >
            Edit
          </Link>
        ) : null}
        <RefreshButton />
      </div>

      {/* Secondary actions — destructive lives alongside its sibling
          helper copy so the user knows what each does. Refresh is a
          rescan of the same handle; Delete wipes the profile so they
          can start fresh. */}
      <div className="mt-6 border-t border-border/30 pt-5">
        <div className="grid grid-cols-1 gap-4 text-[12px] text-muted-foreground sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <span className="text-foreground font-medium">Refresh</span>
            <span>Rescans your GitHub and regenerates the profile. Keeps your edits; runs once per 24h.</span>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-foreground font-medium">Delete profile</span>
            <span>Wipes scans, edits, and the public page. You&apos;ll start over from intake.</span>
            <DeleteProfileButton />
          </div>
        </div>
      </div>
    </section>
  );
}

