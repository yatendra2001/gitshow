"use client";

import { useState } from "react";
import type { ProfileCard } from "@gitshow/shared/schemas";

/**
 * CriticVerdictCard — surfaces the hiring-manager agent's self-eval
 * alongside the user's profile. Design follows the "always shown,
 * frame as strength not weakness" rule — we lead with the positive
 * ("forwardable / would-share") and let the user expand for details.
 *
 * Shown on the authed workspace only. The public profile does NOT
 * render it — recruiters see the card, not the self-review.
 */

type HiringReview = NonNullable<ProfileCard["meta"]["hiring_review"]>;

export function CriticVerdictCard({
  review,
  onAcceptFix,
  onChallenge,
}: {
  review: HiringReview;
  /** Called when user taps a top-fix "Accept" button → triggers revise. */
  onAcceptFix?: (fix: { axis: string; fix: string; claim_id?: string }) => void;
  /** Called when user disagrees with a top-fix → opens revise composer prefilled. */
  onChallenge?: (fix: { axis: string; fix: string; claim_id?: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const verdict = review.verdict;
  const verdictColor =
    verdict === "PASS"
      ? "bg-[var(--chart-3)]/15 border-[var(--chart-3)]/40 text-[var(--chart-3)]"
      : verdict === "REVISE"
        ? "bg-[var(--chart-4)]/15 border-[var(--chart-4)]/40 text-[var(--chart-4)]"
        : "bg-[var(--destructive)]/15 border-[var(--destructive)]/40 text-[var(--destructive)]";

  return (
    <section className="rounded-2xl border border-border/40 bg-card/60 p-5 sm:p-6">
      <header className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
            Agent self-review
          </div>
          <h3 className="text-[16px] font-medium leading-snug">
            {review.would_forward
              ? "This would hold up with a senior engineer."
              : "Honest read — this needs another pass."}
          </h3>
        </div>
        <span
          className={`inline-flex items-center gap-2 rounded-xl border px-2.5 py-1 text-[11px] font-medium ${verdictColor}`}
        >
          <span className="font-mono">{review.overall_score}/100</span>
          <span>{verdict}</span>
        </span>
      </header>

      <p className="text-[13px] leading-relaxed text-foreground/85 mb-3">
        {review.why}
      </p>

      {review.top_fixes.length > 0 ? (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-[12px] text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
            aria-expanded={open}
          >
            <Chevron open={open} />
            {open ? "Hide" : "Show"} {review.top_fixes.length} suggested{" "}
            {review.top_fixes.length === 1 ? "fix" : "fixes"}
          </button>

          {open ? (
            <ul className="mt-3 space-y-2">
              {review.top_fixes.map((f, i) => (
                <li
                  key={i}
                  className="rounded-xl border border-border/30 bg-background/50 p-3"
                >
                  <div className="flex items-baseline justify-between gap-2 mb-1">
                    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      {f.axis}
                    </span>
                  </div>
                  <p className="text-[13px] leading-relaxed">{f.fix}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {onAcceptFix ? (
                      <button
                        type="button"
                        onClick={() => onAcceptFix(f)}
                        className="rounded-lg border border-border/50 bg-card/60 px-3 py-1.5 text-[12px] hover:bg-card transition-colors min-h-9"
                      >
                        Accept & revise
                      </button>
                    ) : null}
                    {onChallenge ? (
                      <button
                        type="button"
                        onClick={() => onChallenge(f)}
                        className="rounded-lg px-3 py-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors min-h-9"
                      >
                        Disagree
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}

      {review.block_triggers.length > 0 ? (
        <div className="mt-3 rounded-xl border border-[var(--destructive)]/30 bg-[var(--destructive)]/[0.05] p-3">
          <div className="text-[11px] uppercase tracking-wide text-[var(--destructive)]/80 mb-1">
            Block triggers
          </div>
          <ul className="list-disc list-inside text-[12px] space-y-0.5 text-foreground/80">
            {review.block_triggers.slice(0, 5).map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform duration-200 ${open ? "rotate-90" : ""}`}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
