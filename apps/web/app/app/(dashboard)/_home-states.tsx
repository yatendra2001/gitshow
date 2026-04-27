import Link from "next/link";
import { Check, ExternalLink, Lock, Users, GitPullRequest } from "lucide-react";
import {
  AccessStateCard,
  type AccessState,
  type DataSources,
} from "@/components/scan/access-state-card";
import { StartFirstScanButton } from "./_start-button";
import { DeleteProfileButton } from "./_delete-profile-button";
import { CancelScanButton } from "./_cancel-scan-button";
import { PublishDraftButton } from "./_publish-draft-button";
import { CheckoutProcessingAutoRefresh } from "./_checkout-processing";

/**
 * Pre-analytics state surfaces for `/app`.
 *
 * The dashboard layout always wraps these in the sidebar shell. The
 * page chooses which one to render based on whether the user has a
 * published profile, a draft pending review, an in-progress scan,
 * a failed scan, or none of the above.
 *
 * `NonProShowcase` and `CheckoutProcessingState` render full-bleed
 * outside the shell — see `(dashboard)/page.tsx`.
 */

export interface ScanSlim {
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

export function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// ─── Empty (no scan yet) ──────────────────────────────────────────

export function EmptyState({ handle }: { handle: string }) {
  return (
    <section className="mx-auto w-full max-w-xl px-4 sm:px-6 py-16 gs-enter">
      <div className="text-[12px] uppercase tracking-wide text-muted-foreground/80 mb-2">
        Welcome
      </div>
      <h1 className="font-[var(--font-serif)] text-[32px] leading-tight mb-3">
        Build your portfolio
      </h1>
      <p className="text-[14px] leading-relaxed text-muted-foreground mb-6">
        We&apos;ll read your GitHub, pull in any links you share (LinkedIn,
        blog, personal site), then run a full analysis. Close the tab
        whenever — we&apos;ll email you when it&apos;s live at{" "}
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
          className="group self-start inline-flex items-center gap-1 rounded-lg border border-border/60 bg-card/40 px-2.5 py-1 text-[11.5px] font-medium select-none transition-[background-color,border-color,transform] duration-[140ms] ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-card/60 hover:border-foreground/25 active:scale-[0.97] active:duration-[80ms] outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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

// ─── Scan running ────────────────────────────────────────────────

export function ScanningState({ scan }: { scan: ScanSlim }) {
  const elapsedMin = Math.max(1, Math.round((Date.now() - scan.created_at) / 60000));
  return (
    <section className="mx-auto w-full max-w-xl px-4 sm:px-6 py-16 gs-enter">
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
          className="inline-flex items-center min-h-11 rounded-xl bg-foreground text-background px-4 py-2 text-[13px] font-medium select-none shadow-[inset_0_1px_0_rgb(255_255_255_/_0.10),0_1px_2px_-1px_oklch(0_0_0_/_0.20)] transition-[background-color,box-shadow,transform,opacity] duration-[140ms] ease-[cubic-bezier(0.4,0,0.2,1)] hover:shadow-[inset_0_1px_0_rgb(255_255_255_/_0.14),0_2px_8px_-3px_oklch(0_0_0_/_0.24)] active:scale-[0.97] active:duration-[80ms] outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          See live progress →
        </Link>
        <CancelScanButton scanId={scan.id} />
      </div>
    </section>
  );
}

// ─── Draft awaiting publish ──────────────────────────────────────

export function DraftState({
  handle,
  access,
}: {
  handle: string;
  access: {
    accessState: AccessState | null;
    dataSources: DataSources | null;
  } | null;
}) {
  const hasLocked =
    (access?.accessState?.orgs ?? []).some(
      (o) => o.state === "sso_required" || o.state === "oauth_restricted",
    );
  return (
    <section className="mx-auto w-full max-w-xl px-4 sm:px-6 py-16 gs-enter">
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
          className="inline-flex items-center min-h-11 rounded-xl bg-foreground text-background px-4 py-2 text-[13px] font-medium select-none shadow-[inset_0_1px_0_rgb(255_255_255_/_0.10),0_1px_2px_-1px_oklch(0_0_0_/_0.20)] transition-[background-color,box-shadow,transform,opacity] duration-[140ms] ease-[cubic-bezier(0.4,0,0.2,1)] hover:shadow-[inset_0_1px_0_rgb(255_255_255_/_0.14),0_2px_8px_-3px_oklch(0_0_0_/_0.24)] active:scale-[0.97] active:duration-[80ms] outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Preview draft →
        </Link>
        <Link
          href="/app/edit"
          className="inline-flex items-center min-h-11 rounded-xl border border-border/60 bg-card/30 px-4 py-2 text-[13px] font-medium select-none transition-[background-color,border-color,transform] duration-[140ms] ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-card/50 hover:border-foreground/25 active:scale-[0.97] active:duration-[80ms] outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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
    </section>
  );
}

// ─── Last scan failed ────────────────────────────────────────────

export function FailedState({ scan }: { scan: ScanSlim }) {
  return (
    <section className="mx-auto w-full max-w-xl px-4 sm:px-6 py-16 gs-enter">
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

// ─── Published — used as the page footer beneath analytics ──────

export function PublishedFooter({
  daysSinceScan,
}: {
  daysSinceScan: number | null;
}) {
  const refreshedLabel =
    daysSinceScan === null
      ? null
      : daysSinceScan === 0
        ? "today"
        : daysSinceScan === 1
          ? "yesterday"
          : `${daysSinceScan} days ago`;

  return (
    <div className="mt-10 border-t border-border/30 pt-6 flex flex-col gap-4">
      {refreshedLabel ? (
        <p className="text-[12px] text-muted-foreground">
          Last refreshed {refreshedLabel}.
        </p>
      ) : null}
      <div className="flex flex-col gap-2 text-[12px] text-muted-foreground">
        <span className="text-foreground font-medium text-[13px]">
          Delete profile
        </span>
        <span>
          Wipes scans and the public page. You&apos;ll start over from intake.
        </span>
        <DeleteProfileButton />
      </div>
    </div>
  );
}

// ─── Post-checkout, pre-webhook ─────────────────────────────────

export function CheckoutProcessingState() {
  return (
    <section className="mx-auto w-full max-w-xl px-4 sm:px-6 py-16 gs-enter">
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

// ─── Non-Pro showcase ───────────────────────────────────────────

const PRO_FEATURES = [
  "AI-generated portfolio from your GitHub history",
  "Unlimited regenerations and edits",
  "Private + org repos",
  "Custom domain",
  "Powerful analytics — see who viewed what",
  "Resume + PDF export",
] as const;

export function NonProShowcase({
  handle,
  hasPublished,
  wasCancelled,
}: {
  handle: string;
  hasPublished: boolean;
  wasCancelled: boolean;
}) {
  return (
    <section className="mx-auto w-full max-w-xl px-4 sm:px-6 py-16 gs-enter">
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
          className="inline-flex items-center min-h-11 rounded-xl bg-foreground text-background px-4 py-2 text-[13px] font-medium select-none shadow-[inset_0_1px_0_rgb(255_255_255_/_0.10),0_1px_2px_-1px_oklch(0_0_0_/_0.20)] transition-[background-color,box-shadow,transform,opacity] duration-[140ms] ease-[cubic-bezier(0.4,0,0.2,1)] hover:shadow-[inset_0_1px_0_rgb(255_255_255_/_0.14),0_2px_8px_-3px_oklch(0_0_0_/_0.24)] active:scale-[0.97] active:duration-[80ms] outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {wasCancelled ? "Re-subscribe →" : "See pricing →"}
        </Link>
        {hasPublished && handle ? (
          <Link
            href={`/${handle.toLowerCase()}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center min-h-11 rounded-xl border border-border/60 bg-card/30 px-4 py-2 text-[13px] font-medium select-none transition-[background-color,border-color,transform] duration-[140ms] ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-card/50 hover:border-foreground/25 active:scale-[0.97] active:duration-[80ms] outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            View your live portfolio ↗
          </Link>
        ) : null}
      </div>
    </section>
  );
}
