"use client";

/**
 * Shared streaming-UI primitives for the resume generators.
 *
 * Both flows that watch the AI write a resume in real time use the
 * same building blocks:
 *
 *   - The empty-state generator in `/app/resume` (no doc yet, first
 *     generation from the portfolio).
 *   - The "Tailor for job" flow in `/app/resume/tailored/new` (a JD-
 *     specific variant of an existing doc).
 *
 * Rather than duplicating the shimmer CSS, the status banner, and the
 * progress-label heuristic in two places, this module exposes:
 *
 *   <ResumeStreamCss />           — injects RESUME_PRINT_CSS + shimmer keyframes.
 *   <ResumeStreamBanner ... />    — sticky/inline banner showing status.
 *   <ResumeShimmerPlaceholder />  — 8.5×11 silhouette shown before the first partial.
 *   progressLabelFor(doc, kind)   — picks a human label from a partial doc.
 *
 * Layout decisions (sticky vs inline, full-page vs dialog) stay with
 * the parent so each surface can compose these primitives to fit its
 * shell.
 */

import { HugeiconsIcon } from "@hugeicons/react";
import { Tick02Icon } from "@hugeicons/core-free-icons";
import type { ResumeDoc } from "@gitshow/shared/resume-doc";
import { cn } from "@/lib/utils";
import { RESUME_PRINT_CSS } from "./printable";

/**
 * Shimmer + fade-in + bouncing-dots keyframes. Scoped to `.gs-stream-…`
 * class names so two surfaces can mount the CSS without collisions.
 * Honors `prefers-reduced-motion` by collapsing every animation to a
 * static end state.
 */
export const RESUME_STREAM_CSS = `
@keyframes gs-stream-shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
.gs-stream-shimmer-bar {
  display: block;
  background: linear-gradient(
    90deg,
    #ececec 0%,
    #f6f6f6 45%,
    #fafafa 50%,
    #f6f6f6 55%,
    #ececec 100%
  );
  background-size: 200% 100%;
  animation: gs-stream-shimmer 1.6s linear infinite;
  border-radius: 2pt;
}
@keyframes gs-stream-fade-in {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
.gs-stream-reveal {
  animation: gs-stream-fade-in 260ms cubic-bezier(0.2, 0.6, 0.2, 1) both;
}
@keyframes gs-stream-dot {
  0%, 80%, 100% { opacity: 0.25; transform: scale(0.7); }
  40%           { opacity: 1;    transform: scale(1); }
}
.gs-stream-dot { animation: gs-stream-dot 1.2s ease-in-out infinite both; }
.gs-stream-dot:nth-child(2) { animation-delay: 0.15s; }
.gs-stream-dot:nth-child(3) { animation-delay: 0.3s; }
@media (prefers-reduced-motion: reduce) {
  .gs-stream-shimmer-bar { animation: none; background: #eee; }
  .gs-stream-reveal { animation: none; }
  .gs-stream-dot { animation: none; opacity: 0.6; }
}
`;

/**
 * Mount the print stylesheet + streaming animations once at the top of
 * the surface that's streaming. `styled-jsx` strips template-literal-
 * only `<style jsx global>` blocks at runtime, so we go through a
 * plain `<style>` with `dangerouslySetInnerHTML`.
 */
export function ResumeStreamCss() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: RESUME_PRINT_CSS + RESUME_STREAM_CSS,
      }}
    />
  );
}

/**
 * Status banner used by every streaming surface. Bouncing dots while
 * streaming, a check + "ready" label on `done`. Parents control
 * placement (sticky top, inline within a dialog card, etc.) via
 * `className` — the banner itself only owns its inner row.
 */
export function ResumeStreamBanner({
  statusLabel,
  done,
  title,
  className,
}: {
  statusLabel: string;
  done: boolean;
  /** Optional title override — defaults to "Generating your resume" / "Resume ready". */
  title?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      {done ? (
        <HugeiconsIcon
          icon={Tick02Icon}
          size={14}
          strokeWidth={2}
          className="shrink-0 text-foreground"
        />
      ) : (
        <span className="shrink-0 inline-flex items-center gap-1" aria-hidden>
          <span className="gs-stream-dot inline-block size-1.5 rounded-full bg-foreground/70" />
          <span className="gs-stream-dot inline-block size-1.5 rounded-full bg-foreground/70" />
          <span className="gs-stream-dot inline-block size-1.5 rounded-full bg-foreground/70" />
        </span>
      )}
      <span className="text-[12.5px] font-medium tracking-tight">
        {title ?? (done ? "Resume ready" : "Generating your resume")}
      </span>
      <span className="text-[12px] text-muted-foreground/80 truncate">
        · {statusLabel}
      </span>
    </div>
  );
}

/**
 * Animated 8.5×11 silhouette shown before the first partial event
 * lands. Each bar shimmers with a moving gradient so the 5-10s spin-
 * up window before any tokens arrive feels alive — not a dead static
 * page. Matches the printable's typographic rhythm so the cross-fade
 * into real content feels continuous.
 */
export function ResumeShimmerPlaceholder() {
  return (
    <div
      className="resume-doc"
      style={{
        width: "8.5in",
        minHeight: "11in",
        boxShadow:
          "0 1px 2px rgba(0,0,0,0.04), 0 8px 32px rgba(0,0,0,0.08)",
      }}
    >
      <div className="resume-header">
        <div
          className="gs-stream-shimmer-bar"
          style={{ height: "20pt", width: "60%", margin: "0 auto 4pt" }}
        />
        <div
          className="gs-stream-shimmer-bar"
          style={{ height: "10pt", width: "75%", margin: "0 auto 4pt" }}
        />
        <div
          className="gs-stream-shimmer-bar"
          style={{ height: "9pt", width: "85%", margin: "0 auto" }}
        />
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="resume-section">
          <div
            className="gs-stream-shimmer-bar"
            style={{ height: "10pt", width: "120pt", margin: "0 0 6pt 0" }}
          />
          {[0, 1, 2].map((j) => (
            <div
              key={j}
              className="gs-stream-shimmer-bar"
              style={{
                height: "9pt",
                width: `${85 - j * 8}%`,
                margin: "3pt 0",
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Pick a human-readable progress label from the doc's current shape.
 * The model emits sections in order, so the first non-empty section
 * we don't yet see is the one being written *now*.
 *
 * `kind` swaps the verb language between fresh generation and JD
 * tailoring, so the user sees "drafting" vs "tailoring" — same
 * structure, accurate vocabulary.
 */
export function progressLabelFor(
  doc: ResumeDoc,
  kind: "generate" | "tailor",
): string {
  const v = kind === "tailor" ? tailorVerbs : generateVerbs;
  if (!doc.header.name) return v.reading;
  if (doc.experience.length === 0) return v.headline;
  const lastExp = doc.experience[doc.experience.length - 1];
  if (lastExp && lastExp.bullets.length === 0) {
    return v.bulletsFor(lastExp.company || "experience");
  }
  if (doc.projects.length === 0 && doc.experience.length > 0) {
    return v.projects;
  }
  if (doc.education.length === 0 && doc.projects.length > 0) {
    return v.education;
  }
  if (doc.skills.length === 0 && doc.education.length > 0) {
    return v.skills;
  }
  if (doc.skills.length > 0 && doc.awards.length === 0) {
    return v.awards;
  }
  return v.polishing;
}

const generateVerbs = {
  reading: "Reading your portfolio",
  headline: "Drafting your headline",
  bulletsFor: (company: string) => `Writing impact bullets for ${company}`,
  projects: "Picking your top projects",
  education: "Adding education",
  skills: "Grouping skills",
  awards: "Reviewing awards",
  polishing: "Polishing",
};

const tailorVerbs = {
  reading: "Reading the JD",
  headline: "Tailoring your headline",
  bulletsFor: (company: string) => `Rewriting bullets for ${company}`,
  projects: "Re-ranking your projects",
  education: "Slotting education",
  skills: "Regrouping skills",
  awards: "Reviewing awards",
  polishing: "Polishing",
};
