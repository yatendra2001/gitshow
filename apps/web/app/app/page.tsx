import Link from "next/link";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { auth } from "@/auth";
import { LeanProfileCard } from "@/components/profile/lean-card";
import { NotificationBell } from "@/components/notifications/bell";
import { PushEnableButton } from "@/components/notifications/push-enable";
import { getProfileBySlug } from "@/lib/profiles";
import { StartFirstScanButton } from "./_start-button";
import { RefreshButton } from "./_refresh-button";
import { DeleteAccountHandler } from "./_delete-handler";

/**
 * /app — the authenticated home. Single-person model:
 *   - No scan → CTA to start the 60-second intake.
 *   - Scan running → link into the live /s/[id] progress view.
 *   - Scan succeeded → render the lean profile in place + Share /
 *     Refresh / Revise affordances.
 *   - Scan failed → show the last reason + "Try again".
 *
 * The legacy /dashboard multi-scan list is gone; that page now
 * redirects here.
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
  const githubHandle = (session.user.name ?? "").trim();

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
  const lastFailed = latestScan?.status === "failed" && !activeScan && !hasProfile;

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
          card={cardData!.card}
          handle={cardData!.row.handle}
          publicSlug={cardData!.row.public_slug}
          lastScanAt={cardData!.row.last_scan_at}
        />
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
        First up
      </div>
      <h1 className="font-[var(--font-serif)] text-[32px] leading-tight mb-3">
        Let's build your profile.
      </h1>
      <p className="text-[14px] leading-relaxed text-muted-foreground mb-6">
        We'll spend about a minute looking at your GitHub, ask you 3-5
        quick questions, then start a 40-minute scan. You can close the
        tab — we'll email you when it's ready at{" "}
        <span className="font-mono">gitshow.io/{handle || "{handle}"}</span>.
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
        <span>Scanning</span>
      </div>
      <h1 className="font-[var(--font-serif)] text-[32px] leading-tight mb-3">
        We're reading your code.
      </h1>
      <p className="text-[14px] leading-relaxed text-muted-foreground mb-6">
        {scan.current_phase ? (
          <>
            Currently: <span className="text-foreground">{scan.current_phase}</span> · running for{" "}
            {elapsedMin} minute{elapsedMin === 1 ? "" : "s"}.
          </>
        ) : (
          <>Getting set up — this takes about a minute before the first update.</>
        )}
        <br />
        You can close this tab. We'll email you when it's ready.
      </p>
      <div className="flex flex-wrap gap-2">
        <Link
          href={`/s/${scan.id}`}
          className="inline-flex items-center rounded-xl bg-foreground text-background px-4 py-2 text-[13px] font-medium hover:opacity-90 transition-opacity min-h-11"
        >
          Watch progress →
        </Link>
      </div>
    </section>
  );
}

function FailedState({ scan }: { scan: ScanSlim }) {
  return (
    <section className="mx-auto w-full max-w-xl px-4 sm:px-6 py-16">
      <div className="text-[12px] uppercase tracking-wide text-[var(--destructive)]/80 mb-2">
        Didn't finish
      </div>
      <h1 className="font-[var(--font-serif)] text-[32px] leading-tight mb-3">
        The last scan hit a snag.
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

function ProfileState({
  card,
  handle,
  publicSlug,
  lastScanAt,
}: {
  card: import("@gitshow/shared/schemas").ProfileCard;
  handle: string;
  publicSlug: string;
  lastScanAt: number | null;
}) {
  const daysSinceScan = lastScanAt
    ? Math.floor((Date.now() - lastScanAt) / (1000 * 60 * 60 * 24))
    : null;

  return (
    <>
      <section className="mx-auto w-full max-w-3xl px-4 sm:px-6 pt-8 pb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
            Your public profile
          </div>
          <Link
            href={`/${publicSlug}`}
            className="font-mono text-[14px] hover:underline underline-offset-2"
          >
            gitshow.io/{handle}
          </Link>
          {daysSinceScan !== null ? (
            <span className="ml-2 text-[11px] text-muted-foreground/70">
              · refreshed {daysSinceScan === 0 ? "today" : `${daysSinceScan}d ago`}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <RefreshButton />
        </div>
      </section>
      <LeanProfileCard card={card} />
    </>
  );
}

