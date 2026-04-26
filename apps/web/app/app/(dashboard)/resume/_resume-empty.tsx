"use client";

/**
 * Empty state for /app/resume:
 *   - No portfolio at all → nudge user to run a scan first.
 *   - Portfolio exists, no ResumeDoc → "Generate Resume" CTA, fires
 *     /api/resume/doc/generate then reloads to show the editor.
 *
 * The page itself decides which state we're in; this component owns
 * only the visual + the generate flow.
 */

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  MagicWand01Icon,
  Loading03Icon,
  CheckmarkBadge01Icon,
  Tick02Icon,
  AlertCircleIcon,
} from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";

export function ResumeEmpty({ hasResume }: { hasResume: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onGenerate = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const resp = await fetch("/api/resume/doc/generate", { method: "POST" });
      if (!resp.ok) {
        const data = (await resp.json().catch(() => ({}))) as {
          detail?: string;
          error?: string;
        };
        setErr(data.detail || data.error || "Generation failed");
        return;
      }
      router.refresh();
    } catch {
      setErr("Network error");
    } finally {
      setBusy(false);
    }
  }, [busy, router]);

  if (!hasResume) {
    return (
      <section className="mx-auto w-full max-w-xl px-5 sm:px-6 py-16">
        <div className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground/70 mb-2">
          No portfolio yet
        </div>
        <h1 className="text-[28px] sm:text-[32px] leading-tight tracking-tight font-semibold mb-3">
          Run a scan first
        </h1>
        <p className="text-[14px] leading-relaxed text-muted-foreground mb-6">
          Your résumé is generated from your portfolio data — your work,
          projects, education, and skills. Run the AI scan from the dashboard
          to seed everything, then come back here for a one-page export.
        </p>
        <Link
          href="/app"
          className={cn(
            "inline-flex items-center rounded-lg bg-foreground text-background px-4 h-10 text-[13px] font-medium",
            "hover:opacity-90 transition-[opacity] duration-150 ease",
            "min-h-11",
          )}
        >
          Back to dashboard
        </Link>
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-2xl px-5 sm:px-6 py-12 sm:py-16">
      <div className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground/70 mb-2">
        Resume
      </div>
      <h1 className="text-[28px] sm:text-[34px] leading-[1.1] tracking-tight font-semibold mb-3">
        Generate your one-page resume
      </h1>
      <p className="text-[14px] leading-relaxed text-muted-foreground mb-8 max-w-prose">
        We'll turn your portfolio into a printable, ATS-safe resume — impact
        bullets, no fluff, no fancy chrome. Edit anything after, then export to
        PDF in one click.
      </p>

      <div className="rounded-xl border border-border/40 bg-foreground/[0.02] p-4 sm:p-5 mb-6">
        <div className="flex items-start gap-2.5 mb-3">
          <HugeiconsIcon
            icon={CheckmarkBadge01Icon}
            size={18}
            strokeWidth={2}
            className="text-foreground/70 mt-0.5 shrink-0"
          />
          <div className="text-[13px] font-semibold">
            ATS-safe, recruiter-friendly, founder-friendly
          </div>
        </div>
        <ul className="space-y-1.5 text-[12.5px] text-muted-foreground">
          {[
            "Single column · standard fonts · pure black & white",
            "Action-verb impact bullets, quantified where possible",
            "Hard one-page cap, with a live fit indicator",
            "Skills grouped by category for clean parsing",
          ].map((line) => (
            <li key={line} className="flex items-start gap-2">
              <HugeiconsIcon
                icon={Tick02Icon}
                size={13}
                strokeWidth={2.25}
                className="text-foreground/60 mt-0.5 shrink-0"
              />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </div>

      <button
        type="button"
        onClick={onGenerate}
        disabled={busy}
        className={cn(
          "inline-flex items-center gap-2 rounded-lg bg-foreground text-background px-4 h-11 text-[13.5px] font-medium",
          "hover:opacity-90 transition-[opacity] duration-150 ease",
          "disabled:opacity-70 disabled:cursor-progress",
          "min-h-11",
        )}
      >
        <HugeiconsIcon
          icon={busy ? Loading03Icon : MagicWand01Icon}
          size={16}
          strokeWidth={2}
          className={busy ? "animate-spin" : ""}
        />
        {busy ? "Generating with Claude Sonnet…" : "Generate resume"}
      </button>

      <p className="text-[11px] text-muted-foreground/60 mt-3">
        Powered by Claude Sonnet 4.6 · ~10 seconds
      </p>

      {err ? (
        <div
          role="alert"
          className="mt-5 flex items-start gap-2 rounded-lg border border-foreground/15 bg-foreground/[0.04] px-3 py-2.5 text-[12.5px]"
        >
          <HugeiconsIcon
            icon={AlertCircleIcon}
            size={14}
            strokeWidth={2}
            className="mt-0.5 shrink-0"
          />
          <span>{err}</span>
        </div>
      ) : null}
    </section>
  );
}
