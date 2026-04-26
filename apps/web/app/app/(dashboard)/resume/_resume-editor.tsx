"use client";

/**
 * Resume editor shell.
 *
 * Layout: form left (max ~520px), live preview right (scrolls into a
 * fixed page frame). On mobile the preview collapses into a tab pair.
 *
 * State model mirrors /app/edit:
 *   - `doc` is the single source of truth for the editor.
 *   - Each form change calls `onPatch(partial)` which:
 *       1. Optimistically merges into local state.
 *       2. Queues a debounced PATCH /api/resume/doc.
 *       3. Reconciles the server response back into local state.
 *   - "Regenerate bullets" hits /api/resume/doc/regenerate-bullets and
 *     folds the response into the matching experience entry, then
 *     PATCHes.
 *   - "Download PDF" POSTs /api/resume/doc/pdf and triggers a download.
 *
 * Animation policy (Emil): every transition specifies its property,
 * 150ms ease-out for hover, 200ms for entrance. No layout shift on
 * dynamic numbers (tabular-nums on the page-fit indicator).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  Delete02Icon,
  Download04Icon,
  Tick02Icon,
  AlertCircleIcon,
  ArrowUp01Icon,
  ArrowDown01Icon,
  Loading03Icon,
  CheckmarkBadge01Icon,
} from "@hugeicons/core-free-icons";
import type {
  ResumeDoc,
  ExperienceEntry,
  ProjectDocEntry,
  EducationDocEntry,
  SkillGroup,
  AwardEntry,
  PublicationDocEntry,
  ResumeSectionKey,
} from "@gitshow/shared/resume-doc";
// Letter page height at 96dpi (the canonical browser unit). Used for
// the DOM-measurement-based fit indicator.
const LETTER_PAGE_HEIGHT_PX = 11 * 96; // 1056

// With Inter loaded from Google Fonts on both surfaces (editor preview
// + Cloudflare Browser Rendering), the glyph metrics are byte-
// identical and the editor's scrollHeight should match the PDF's
// content height almost exactly. We still keep a small buffer for
// any residual rounding (sub-pixel rendering, anti-aliasing) — 16px
// is well under one line and prevents borderline cases from
// embarrassing us.
const PDF_VARIANCE_BUFFER_PX = 16;
const NEAR_BUFFER_PX = 60;
import { cn } from "@/lib/utils";
import {
  PrintableResume,
  RESUME_PRINT_CSS,
} from "@/components/resume/printable";

const SAVE_DEBOUNCE_MS = 700;

type Status = "idle" | "saving" | "saved" | "error";

export function ResumeEditor({
  initialDoc,
}: {
  initialDoc: ResumeDoc;
}) {
  const [doc, setDoc] = useState<ResumeDoc>(initialDoc);
  const [status, setStatus] = useState<Status>("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  // PDF generation has 4 visible phases. We drive the percentage with
  // a smooth easeOut curve over the expected wall-clock time, then
  // snap to 100 when the fetch resolves. Phase labels swap as pct
  // crosses each band so the user always knows what's happening.
  const [downloadPct, setDownloadPct] = useState(0);
  const [downloadLabel, setDownloadLabel] = useState("Starting");
  // The actual rendered height of the resume in CSS pixels. Updated by
  // a ResizeObserver in PreviewPane. `null` until the first measurement
  // lands — we treat null as "good" so the chip doesn't flicker.
  const [renderedHeight, setRenderedHeight] = useState<number | null>(null);

  const pendingRef = useRef<Record<string, unknown>>({});
  const progressRafRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);

  const flush = useCallback(async () => {
    const patch = pendingRef.current;
    if (Object.keys(patch).length === 0 || inFlightRef.current) return;
    pendingRef.current = {};
    inFlightRef.current = true;
    setStatus("saving");
    try {
      const resp = await fetch("/api/resume/doc", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patch }),
      });
      if (!resp.ok) {
        const err = (await resp.json().catch(() => ({}))) as { error?: string };
        setStatus("error");
        setErrMsg(humanizeError(err.error));
        return;
      }
      const data = (await resp.json()) as { doc: ResumeDoc };
      setDoc(data.doc);
      setStatus("saved");
      setErrMsg(null);
      // Drop back to idle after a beat — saved state is for confidence,
      // not a permanent badge.
      setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 1200);
    } catch {
      setStatus("error");
      setErrMsg("Network error");
    } finally {
      inFlightRef.current = false;
      // If patches landed during the in-flight, kick another flush.
      if (Object.keys(pendingRef.current).length > 0) {
        timerRef.current = setTimeout(flush, 50);
      }
    }
  }, []);

  const onPatch = useCallback(
    (patch: Partial<ResumeDoc>) => {
      // Optimistic merge — the server validates on PATCH and bumps meta.
      setDoc((prev) => mergeShallowDeep(prev, patch));
      Object.assign(pendingRef.current, patch);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
    },
    [flush],
  );

  // Flush any pending edits on unload.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const onDownload = useCallback(async () => {
    if (downloading) return;
    setDownloading(true);
    setErrMsg(null);
    setDownloadPct(0);
    setDownloadLabel("Starting");

    // Smooth easeOut progress driven by elapsed time. The curve
    // 1 - exp(-3t) hits 95% at the expected duration and then
    // asymptotes — feels honest because the real bottleneck (PDF
    // render) slows as it nears completion. We snap to 100 when the
    // fetch actually resolves.
    const startedAt = performance.now();
    const expectedMs = 9000;
    const tick = () => {
      const elapsed = performance.now() - startedAt;
      const t = elapsed / expectedMs;
      const eased = 1 - Math.exp(-3 * t);
      const pct = Math.min(eased * 95, 95);
      setDownloadPct(pct);
      setDownloadLabel(labelForPct(pct));
      progressRafRef.current = requestAnimationFrame(tick);
    };
    progressRafRef.current = requestAnimationFrame(tick);

    try {
      const resp = await fetch("/api/resume/doc/pdf", { method: "POST" });
      if (!resp.ok) {
        const err = (await resp.json().catch(() => ({}))) as {
          error?: string;
          detail?: string;
        };
        setErrMsg(err.detail || humanizeError(err.error));
        if (progressRafRef.current)
          cancelAnimationFrame(progressRafRef.current);
        progressRafRef.current = null;
        setDownloading(false);
        return;
      }
      const blob = await resp.blob();
      // Stop the easing tick and finish the bar — the user sees a
      // satisfying snap to 100 instead of the asymptotic crawl.
      if (progressRafRef.current)
        cancelAnimationFrame(progressRafRef.current);
      progressRafRef.current = null;
      setDownloadPct(100);
      setDownloadLabel("Ready");

      const filename =
        (doc.header.name || "resume").toLowerCase().replace(/[^a-z0-9]+/g, "-") +
        "-resume.pdf";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      // Hold the "Ready" state briefly so the 100% feels intentional
      // rather than an instant flash, then return to the idle button.
      setTimeout(() => {
        setDownloading(false);
        setDownloadPct(0);
      }, 700);
    } catch {
      if (progressRafRef.current)
        cancelAnimationFrame(progressRafRef.current);
      progressRafRef.current = null;
      setErrMsg("PDF download failed");
      setDownloading(false);
    }
  }, [doc.header.name, downloading]);

  // Cancel any pending progress tick if the editor unmounts mid-render.
  useEffect(() => {
    return () => {
      if (progressRafRef.current)
        cancelAnimationFrame(progressRafRef.current);
    };
  }, []);

  const fitTier = fitTierForHeight(renderedHeight);

  return (
    <div className="flex flex-col min-h-[calc(100svh-3.5rem)]">
      <Toolbar
        status={status}
        errMsg={errMsg}
        onDownload={onDownload}
        downloading={downloading}
        downloadPct={downloadPct}
        downloadLabel={downloadLabel}
        fitTier={fitTier}
      />

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[minmax(0,520px)_minmax(0,1fr)]">
        {/* Form pane */}
        <div className="border-r border-border/30 lg:overflow-y-auto lg:max-h-[calc(100svh-3.5rem-3.5rem)] gs-pane-scroll">
          <div className="px-5 py-6 space-y-6">
            <AtsBadge />
            <HeaderForm doc={doc} onPatch={onPatch} />
            <ExperienceForm doc={doc} onPatch={onPatch} />
            <ProjectsForm doc={doc} onPatch={onPatch} />
            <EducationForm doc={doc} onPatch={onPatch} />
            <SkillsForm doc={doc} onPatch={onPatch} />
            <AwardsForm doc={doc} onPatch={onPatch} />
            <PublicationsForm doc={doc} onPatch={onPatch} />
            <SectionVisibilityForm doc={doc} onPatch={onPatch} />
          </div>
        </div>

        {/* Preview pane */}
        <PreviewPane doc={doc} fitTier={fitTier} onMeasure={setRenderedHeight} />
      </div>
    </div>
  );
}

/**
 * Three tiers driven by the resume's actual rendered height. Subtle
 * by design — comfortable is silent, near is amber, over is red. We
 * don't strobe; the tier just colors the indicator and the tooltip
 * explains the next step.
 *
 * Threshold: the Letter page is 11in (= 1056px at 96dpi). We grant a
 * ~50px safety buffer (≈3 typeset lines) before flipping to "near"
 * so the user gets a heads-up before they cross over.
 */
type FitTier = "good" | "near" | "over";
function fitTierForHeight(heightPx: number | null): FitTier {
  if (heightPx == null) return "good";
  // The "effective" page height the user can fill in the browser
  // before the PDF will overflow. Real PDF capacity is 1056px but we
  // hold back PDF_VARIANCE_BUFFER_PX to defend against font-metric
  // drift between browser preview and Cloudflare Browser Rendering.
  const overThreshold = LETTER_PAGE_HEIGHT_PX - PDF_VARIANCE_BUFFER_PX;
  const nearThreshold = overThreshold - NEAR_BUFFER_PX;
  if (heightPx > overThreshold) return "over";
  if (heightPx > nearThreshold) return "near";
  return "good";
}

// ──────────────────────────────────────────────────────────────
// Toolbar
// ──────────────────────────────────────────────────────────────

function Toolbar({
  status,
  errMsg,
  onDownload,
  downloading,
  downloadPct,
  downloadLabel,
  fitTier,
}: {
  status: Status;
  errMsg: string | null;
  onDownload: () => void;
  downloading: boolean;
  downloadPct: number;
  downloadLabel: string;
  fitTier: FitTier;
}) {
  return (
    <div className="sticky top-14 z-10 flex items-center gap-3 border-b border-border/30 bg-background/85 backdrop-blur px-5 h-14">
      <div className="flex items-center gap-2 min-w-0">
        <h1 className="text-[14px] font-semibold tracking-tight">Resume</h1>
        <span className="text-[11px] text-muted-foreground">
          One page · ATS-safe
        </span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <FitIndicator tier={fitTier} />
        <SaveBadge status={status} errMsg={errMsg} />
        <DownloadButton
          onClick={onDownload}
          downloading={downloading}
          pct={downloadPct}
          label={downloadLabel}
        />
      </div>
    </div>
  );
}

/**
 * Download button with an in-place progress fill. Idle state is the
 * standard primary button; the moment the user clicks, the same
 * button morphs into a progress chip — same dimensions, same rounded
 * corners, same typography — with a thin progress strip running
 * along the bottom edge. Fill scales from 0% → 100% with a smooth
 * easeOut curve.
 *
 * Why no width/layout change? Anything that resizes the button on
 * click looks like a bug, even when intentional. We pin the width
 * (min-w-[148px]) so the button stays put while content swaps
 * inside.
 */
function DownloadButton({
  onClick,
  downloading,
  pct,
  label,
}: {
  onClick: () => void;
  downloading: boolean;
  pct: number;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={downloading}
      className={cn(
        "relative overflow-hidden inline-flex items-center justify-center gap-1.5",
        "rounded-md h-8 px-3 text-[12px] font-medium",
        "bg-foreground text-background min-h-9 min-w-[148px]",
        "transition-[opacity] duration-150 ease",
        "disabled:cursor-progress",
      )}
      aria-label={
        downloading
          ? `Generating PDF — ${Math.round(pct)} percent complete`
          : "Download resume as PDF"
      }
      aria-live="polite"
      aria-busy={downloading}
      aria-valuenow={downloading ? Math.round(pct) : undefined}
      aria-valuemin={downloading ? 0 : undefined}
      aria-valuemax={downloading ? 100 : undefined}
      role={downloading ? "progressbar" : undefined}
    >
      {/* Progress fill underlay — slightly lighter than the button
          background so it reads as a fill without breaking the
          button's identity. Sits at 0 width when idle. */}
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-0 left-0 origin-left",
          "bg-background/15",
          "transition-[transform] duration-150 ease-out",
        )}
        style={{
          width: "100%",
          transform: `scaleX(${downloading ? pct / 100 : 0})`,
        }}
      />
      {/* Bottom strip — the precise progress indicator. Visible only
          while downloading; fades out on completion. */}
      <span
        aria-hidden
        className={cn(
          "absolute bottom-0 left-0 h-[2px] origin-left",
          "bg-background/55",
          "transition-[transform,opacity] duration-150 ease-out",
        )}
        style={{
          width: "100%",
          transform: `scaleX(${downloading ? pct / 100 : 0})`,
          opacity: downloading ? 1 : 0,
        }}
      />
      <span className="relative z-10 inline-flex items-center gap-1.5 tabular-nums">
        <HugeiconsIcon
          icon={downloading ? Loading03Icon : Download04Icon}
          size={14}
          strokeWidth={2}
          className={downloading ? "animate-spin" : ""}
        />
        {downloading ? (
          <>
            <span>{Math.round(pct)}%</span>
            <span className="opacity-75 font-normal">· {label}</span>
          </>
        ) : (
          "Download PDF"
        )}
      </span>
    </button>
  );
}

/**
 * Map a percentage to a phase label. The bands roughly track when
 * Cloudflare Browser Rendering is doing each step in practice — they
 * land near the right phase even though we're not getting real signals
 * from the server. Honest enough that "Rendering layout" appears when
 * Puppeteer is actually rendering the page.
 */
function labelForPct(pct: number): string {
  if (pct < 12) return "Connecting";
  if (pct < 35) return "Loading fonts";
  if (pct < 65) return "Rendering layout";
  if (pct < 85) return "Generating PDF";
  return "Almost there";
}

/**
 * Dashed line + label at the Letter page boundary (11in down inside
 * the scaled wrapper). Renders only when the doc actually crosses
 * the boundary — when everything fits there's no break to mark.
 *
 * The label sits to the right of the line so it doesn't collide with
 * resume content. Pointer-events disabled so click-through to the
 * resume keeps working.
 */
function PageBreakGuide({ overflowing }: { overflowing: boolean }) {
  if (!overflowing) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute left-0 right-0 z-20"
      style={{
        top: "11in",
        height: "0",
        borderTop: "1.5pt dashed rgb(220, 38, 38)",
      }}
    >
      <span
        className="absolute right-0 -translate-y-1/2 px-1.5 py-0.5 rounded text-[9pt] font-semibold uppercase tracking-wider"
        style={{
          top: "0",
          background: "rgb(220, 38, 38)",
          color: "#fff",
          letterSpacing: "0.6pt",
        }}
      >
        Page 1 ends · content below is page 2
      </span>
    </div>
  );
}

function FitIndicator({ tier }: { tier: FitTier }) {
  // Subtle 3-tier styling. The tier change is the only signal — no
  // pulse, no flash. Label is short and actionable; tooltip carries
  // the next-step nudge.
  const tierStyle = {
    good: {
      cls: "bg-foreground/[0.04] text-muted-foreground",
      icon: Tick02Icon,
      label: "Fits 1 page",
      title: "Within the one-page budget — looks good for export",
    },
    near: {
      cls: "bg-amber-400/10 text-amber-700 dark:text-amber-400",
      icon: AlertCircleIcon,
      label: "Tight fit",
      title: "Close to the one-page limit — consider trimming a bullet or two",
    },
    over: {
      cls: "bg-red-500/10 text-red-700 dark:text-red-400",
      icon: AlertCircleIcon,
      label: "Over 1 page",
      title: "Content exceeds one page — cut bullets or hide a section",
    },
  } as const;
  const t = tierStyle[tier];
  return (
    <div
      className={cn(
        "hidden sm:inline-flex items-center gap-1.5 rounded-md px-2 h-7 text-[11px] font-medium",
        "transition-[background-color,color] duration-200 ease-out",
        t.cls,
      )}
      title={t.title}
      role="status"
      aria-live="polite"
    >
      <HugeiconsIcon icon={t.icon} size={12} strokeWidth={2} />
      <span>{t.label}</span>
    </div>
  );
}

function SaveBadge({
  status,
  errMsg,
}: {
  status: Status;
  errMsg: string | null;
}) {
  if (status === "idle") return null;
  const config = {
    saving: { label: "Saving…", icon: Loading03Icon, spin: true },
    saved: { label: "Saved", icon: Tick02Icon, spin: false },
    error: { label: errMsg || "Error", icon: AlertCircleIcon, spin: false },
  } as const;
  const c = config[status as Exclude<Status, "idle">];
  return (
    <span
      className={cn(
        "hidden md:inline-flex items-center gap-1 text-[11px]",
        status === "error" ? "text-foreground" : "text-muted-foreground",
      )}
      role="status"
      aria-live="polite"
    >
      <HugeiconsIcon
        icon={c.icon}
        size={12}
        strokeWidth={2}
        className={c.spin ? "animate-spin" : ""}
      />
      {c.label}
    </span>
  );
}

function AtsBadge() {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-lg border border-border/40 bg-foreground/[0.02] px-3 py-2.5",
      )}
    >
      <HugeiconsIcon
        icon={CheckmarkBadge01Icon}
        size={16}
        strokeWidth={2}
        className="mt-0.5 text-foreground/70 shrink-0"
      />
      <div className="text-[12px] leading-relaxed">
        <div className="font-semibold text-foreground">
          ATS-safe, recruiter-friendly, founder-friendly
        </div>
        <div className="text-muted-foreground mt-0.5">
          Single column · pure black & white · standard fonts · zero icons in the
          PDF · plain bullets. Built to pass every parser and read clean for a
          human in 10 seconds.
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Form sections
// ──────────────────────────────────────────────────────────────

function SectionShell({
  title,
  count,
  onAdd,
  children,
}: {
  title: string;
  count?: number;
  onAdd?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section>
      <header className="flex items-center justify-between mb-2.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {title}
          {typeof count === "number" ? (
            <span className="ml-1.5 text-muted-foreground/60">{count}</span>
          ) : null}
        </h2>
        {onAdd ? (
          <button
            type="button"
            onClick={onAdd}
            className={cn(
              "inline-flex items-center gap-1 rounded-md h-7 px-2 text-[11px] font-medium",
              "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]",
              "transition-[background-color,color] duration-150 ease",
              "min-h-9",
            )}
            aria-label={`Add to ${title}`}
          >
            <HugeiconsIcon icon={Add01Icon} size={12} strokeWidth={2} />
            Add
          </button>
        ) : null}
      </header>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium text-muted-foreground mb-1">
        {label}
        {hint ? (
          <span className="text-muted-foreground/60 font-normal"> · {hint}</span>
        ) : null}
      </span>
      {children}
    </label>
  );
}

function inputClass(extra?: string) {
  return cn(
    "w-full rounded-md border border-border/60 bg-background px-2.5 py-1.5",
    "text-[13px] text-foreground placeholder:text-muted-foreground/50",
    "focus:outline-none focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10",
    "transition-[border-color,box-shadow] duration-150 ease",
    "min-h-9",
    extra,
  );
}

function HeaderForm({
  doc,
  onPatch,
}: {
  doc: ResumeDoc;
  onPatch: (p: Partial<ResumeDoc>) => void;
}) {
  const h = doc.header;

  function update<K extends keyof typeof h>(key: K, value: (typeof h)[K]) {
    onPatch({ header: { ...h, [key]: value } });
  }

  function setLink(idx: number, key: "label" | "url", value: string) {
    const next = [...h.links];
    next[idx] = { ...next[idx], [key]: value };
    onPatch({ header: { ...h, links: next } });
  }

  function addLink() {
    if (h.links.length >= 4) return;
    onPatch({ header: { ...h, links: [...h.links, { label: "", url: "" }] } });
  }

  function removeLink(idx: number) {
    onPatch({
      header: { ...h, links: h.links.filter((_, i) => i !== idx) },
    });
  }

  return (
    <SectionShell title="Header">
      <Field label="Name">
        <input
          className={inputClass()}
          value={h.name}
          onChange={(e) => update("name", e.target.value)}
          placeholder="Jane Doe"
        />
      </Field>
      <Field
        label="Headline"
        hint="≤90 chars · job title + focus keywords"
      >
        <input
          className={inputClass()}
          value={h.headline}
          onChange={(e) => update("headline", e.target.value)}
          placeholder="Senior Software Engineer · Distributed systems"
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Location">
          <input
            className={inputClass()}
            value={h.location ?? ""}
            onChange={(e) => update("location", e.target.value || undefined)}
            placeholder="San Francisco, CA"
          />
        </Field>
        <Field label="Phone">
          <input
            className={inputClass()}
            value={h.phone ?? ""}
            onChange={(e) => update("phone", e.target.value || undefined)}
            placeholder="(555) 555-5555"
          />
        </Field>
      </div>
      <Field label="Email">
        <input
          className={inputClass()}
          value={h.email ?? ""}
          onChange={(e) => update("email", e.target.value || undefined)}
          placeholder="jane@email.com"
          type="email"
        />
      </Field>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">
            Links <span className="text-muted-foreground/60 font-normal">· up to 4</span>
          </span>
          <button
            type="button"
            onClick={addLink}
            disabled={h.links.length >= 4}
            className={cn(
              "inline-flex items-center gap-1 rounded-md h-6 px-1.5 text-[11px]",
              "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]",
              "transition-[background-color,color] duration-150 ease",
              "disabled:opacity-40",
            )}
            aria-label="Add link"
          >
            <HugeiconsIcon icon={Add01Icon} size={11} strokeWidth={2} />
            Add link
          </button>
        </div>
        <div className="space-y-2">
          {h.links.length === 0 ? (
            <p className="text-[12px] text-muted-foreground/70 italic">
              No links yet — most resumes do well with LinkedIn + GitHub +
              personal site.
            </p>
          ) : null}
          {h.links.map((link, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                className={inputClass("flex-[1.4]")}
                value={link.label}
                onChange={(e) => setLink(i, "label", e.target.value)}
                placeholder="linkedin.com/in/jane"
              />
              <input
                className={inputClass("flex-1")}
                value={link.url}
                onChange={(e) => setLink(i, "url", e.target.value)}
                placeholder="https://linkedin.com/in/jane"
              />
              <IconBtn
                icon={Delete02Icon}
                onClick={() => removeLink(i)}
                ariaLabel="Remove link"
              />
            </div>
          ))}
        </div>
      </div>
    </SectionShell>
  );
}

function ExperienceForm({
  doc,
  onPatch,
}: {
  doc: ResumeDoc;
  onPatch: (p: Partial<ResumeDoc>) => void;
}) {
  const list = doc.experience;

  function setList(next: ExperienceEntry[]) {
    onPatch({ experience: next });
  }

  function update(idx: number, patch: Partial<ExperienceEntry>) {
    setList(list.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  }

  function add() {
    setList([
      ...list,
      {
        id: `exp-${Date.now()}`,
        company: "",
        title: "",
        start: "",
        end: "",
        location: undefined,
        bullets: [],
      },
    ]);
  }

  function remove(idx: number) {
    setList(list.filter((_, i) => i !== idx));
  }

  function move(idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= list.length) return;
    const next = [...list];
    [next[idx], next[target]] = [next[target], next[idx]];
    setList(next);
  }

  return (
    <SectionShell title="Experience" count={list.length} onAdd={add}>
      {list.length === 0 ? (
        <Empty>No experience yet — add your first role.</Empty>
      ) : null}
      {list.map((e, idx) => (
        <EntryCard
          key={e.id}
          onMoveUp={idx > 0 ? () => move(idx, -1) : undefined}
          onMoveDown={idx < list.length - 1 ? () => move(idx, 1) : undefined}
          onRemove={() => remove(idx)}
        >
          <div className="grid grid-cols-2 gap-2">
            <Field label="Company">
              <input
                className={inputClass()}
                value={e.company}
                onChange={(ev) => update(idx, { company: ev.target.value })}
                placeholder="Stripe"
              />
            </Field>
            <Field label="Title">
              <input
                className={inputClass()}
                value={e.title}
                onChange={(ev) => update(idx, { title: ev.target.value })}
                placeholder="Senior Engineer"
              />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Start">
              <input
                className={inputClass()}
                value={e.start}
                onChange={(ev) => update(idx, { start: ev.target.value })}
                placeholder="May 2022"
              />
            </Field>
            <Field label="End">
              <input
                className={inputClass()}
                value={e.end}
                onChange={(ev) => update(idx, { end: ev.target.value })}
                placeholder="Present"
              />
            </Field>
            <Field label="Location">
              <input
                className={inputClass()}
                value={e.location ?? ""}
                onChange={(ev) =>
                  update(idx, { location: ev.target.value || undefined })
                }
                placeholder="SF, CA"
              />
            </Field>
          </div>
          <Field
            label="Bullets"
            hint="One per line · action verb first · wrap metrics in **bold**"
          >
            <BulletsInput
              value={e.bullets}
              onChange={(bullets) => update(idx, { bullets })}
              placeholder={
                "Shipped feature X serving **Y req/sec**, cut p99 by **40%**\nLed migration of **18 services** from A to B over **6 months**\nMentored **3 engineers**; designed promotion ladder doc"
              }
            />
          </Field>
        </EntryCard>
      ))}
    </SectionShell>
  );
}

function ProjectsForm({
  doc,
  onPatch,
}: {
  doc: ResumeDoc;
  onPatch: (p: Partial<ResumeDoc>) => void;
}) {
  const list = doc.projects;
  function setList(next: ProjectDocEntry[]) {
    onPatch({ projects: next });
  }
  function update(idx: number, patch: Partial<ProjectDocEntry>) {
    setList(list.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  }
  function add() {
    setList([
      ...list,
      {
        id: `proj-${Date.now()}`,
        title: "",
        url: undefined,
        dates: undefined,
        stack: undefined,
        bullets: [],
      },
    ]);
  }
  function remove(idx: number) {
    setList(list.filter((_, i) => i !== idx));
  }
  function move(idx: number, dir: -1 | 1) {
    const t = idx + dir;
    if (t < 0 || t >= list.length) return;
    const next = [...list];
    [next[idx], next[t]] = [next[t], next[idx]];
    setList(next);
  }
  return (
    <SectionShell title="Projects" count={list.length} onAdd={add}>
      {list.length === 0 ? <Empty>No projects yet.</Empty> : null}
      {list.map((p, idx) => (
        <EntryCard
          key={p.id}
          onMoveUp={idx > 0 ? () => move(idx, -1) : undefined}
          onMoveDown={idx < list.length - 1 ? () => move(idx, 1) : undefined}
          onRemove={() => remove(idx)}
        >
          <div className="grid grid-cols-2 gap-2">
            <Field label="Title">
              <input
                className={inputClass()}
                value={p.title}
                onChange={(e) => update(idx, { title: e.target.value })}
                placeholder="gitshow"
              />
            </Field>
            <Field label="Dates">
              <input
                className={inputClass()}
                value={p.dates ?? ""}
                onChange={(e) =>
                  update(idx, { dates: e.target.value || undefined })
                }
                placeholder="2025"
              />
            </Field>
          </div>
          <Field label="URL">
            <input
              className={inputClass()}
              value={p.url ?? ""}
              onChange={(e) => update(idx, { url: e.target.value || undefined })}
              placeholder="https://gitshow.io"
            />
          </Field>
          <Field label="Tech stack">
            <input
              className={inputClass()}
              value={p.stack ?? ""}
              onChange={(e) =>
                update(idx, { stack: e.target.value || undefined })
              }
              placeholder="Next.js, Cloudflare Workers, D1, R2"
            />
          </Field>
          <Field
            label="Bullets"
            hint="1-3 lines · wrap metrics in **bold**"
          >
            <BulletsInput
              value={p.bullets}
              onChange={(bullets) => update(idx, { bullets })}
              placeholder="Auto-generates portfolio + resume from any GitHub profile, **12k users**"
            />
          </Field>
        </EntryCard>
      ))}
    </SectionShell>
  );
}

function EducationForm({
  doc,
  onPatch,
}: {
  doc: ResumeDoc;
  onPatch: (p: Partial<ResumeDoc>) => void;
}) {
  const list = doc.education;
  function setList(next: EducationDocEntry[]) {
    onPatch({ education: next });
  }
  function update(idx: number, patch: Partial<EducationDocEntry>) {
    setList(list.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  }
  function add() {
    setList([
      ...list,
      {
        id: `edu-${Date.now()}`,
        school: "",
        degree: "",
        start: "",
        end: "",
      },
    ]);
  }
  function remove(idx: number) {
    setList(list.filter((_, i) => i !== idx));
  }
  function move(idx: number, dir: -1 | 1) {
    const t = idx + dir;
    if (t < 0 || t >= list.length) return;
    const next = [...list];
    [next[idx], next[t]] = [next[t], next[idx]];
    setList(next);
  }
  return (
    <SectionShell title="Education" count={list.length} onAdd={add}>
      {list.length === 0 ? <Empty>No education yet.</Empty> : null}
      {list.map((e, idx) => (
        <EntryCard
          key={e.id}
          onMoveUp={idx > 0 ? () => move(idx, -1) : undefined}
          onMoveDown={idx < list.length - 1 ? () => move(idx, 1) : undefined}
          onRemove={() => remove(idx)}
        >
          <Field label="School">
            <input
              className={inputClass()}
              value={e.school}
              onChange={(ev) => update(idx, { school: ev.target.value })}
              placeholder="University of Waterloo"
            />
          </Field>
          <Field label="Degree">
            <input
              className={inputClass()}
              value={e.degree}
              onChange={(ev) => update(idx, { degree: ev.target.value })}
              placeholder="B.S. Computer Science"
            />
          </Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Start">
              <input
                className={inputClass()}
                value={e.start}
                onChange={(ev) => update(idx, { start: ev.target.value })}
                placeholder="2018"
              />
            </Field>
            <Field label="End">
              <input
                className={inputClass()}
                value={e.end}
                onChange={(ev) => update(idx, { end: ev.target.value })}
                placeholder="2022"
              />
            </Field>
            <Field label="Location">
              <input
                className={inputClass()}
                value={e.location ?? ""}
                onChange={(ev) =>
                  update(idx, { location: ev.target.value || undefined })
                }
                placeholder="Waterloo, ON"
              />
            </Field>
          </div>
          <Field label="Detail" hint="optional · honors / relevant coursework">
            <input
              className={inputClass()}
              value={e.detail ?? ""}
              onChange={(ev) =>
                update(idx, { detail: ev.target.value || undefined })
              }
              placeholder="Dean's List · 3.9 GPA"
            />
          </Field>
        </EntryCard>
      ))}
    </SectionShell>
  );
}

function SkillsForm({
  doc,
  onPatch,
}: {
  doc: ResumeDoc;
  onPatch: (p: Partial<ResumeDoc>) => void;
}) {
  const list = doc.skills;
  function setList(next: SkillGroup[]) {
    onPatch({ skills: next });
  }
  function update(idx: number, patch: Partial<SkillGroup>) {
    setList(list.map((g, i) => (i === idx ? { ...g, ...patch } : g)));
  }
  function add() {
    setList([
      ...list,
      { id: `skill-${Date.now()}`, label: "", items: "" },
    ]);
  }
  function remove(idx: number) {
    setList(list.filter((_, i) => i !== idx));
  }
  function move(idx: number, dir: -1 | 1) {
    const t = idx + dir;
    if (t < 0 || t >= list.length) return;
    const next = [...list];
    [next[idx], next[t]] = [next[t], next[idx]];
    setList(next);
  }
  return (
    <SectionShell title="Skills" count={list.length} onAdd={add}>
      {list.length === 0 ? <Empty>No skill groups yet.</Empty> : null}
      {list.map((g, idx) => (
        <EntryCard
          key={g.id}
          onMoveUp={idx > 0 ? () => move(idx, -1) : undefined}
          onMoveDown={idx < list.length - 1 ? () => move(idx, 1) : undefined}
          onRemove={() => remove(idx)}
        >
          <div className="grid grid-cols-[120px_1fr] gap-2">
            <Field label="Label">
              <input
                className={inputClass()}
                value={g.label}
                onChange={(e) => update(idx, { label: e.target.value })}
                placeholder="Languages"
              />
            </Field>
            <Field label="Items" hint="comma-joined">
              <input
                className={inputClass()}
                value={g.items}
                onChange={(e) => update(idx, { items: e.target.value })}
                placeholder="TypeScript, Go, Python, Rust"
              />
            </Field>
          </div>
        </EntryCard>
      ))}
    </SectionShell>
  );
}

function AwardsForm({
  doc,
  onPatch,
}: {
  doc: ResumeDoc;
  onPatch: (p: Partial<ResumeDoc>) => void;
}) {
  const list = doc.awards;
  function setList(next: AwardEntry[]) {
    onPatch({ awards: next });
  }
  function update(idx: number, patch: Partial<AwardEntry>) {
    setList(list.map((g, i) => (i === idx ? { ...g, ...patch } : g)));
  }
  function add() {
    setList([
      ...list,
      { id: `award-${Date.now()}`, title: "", date: undefined, detail: undefined },
    ]);
  }
  function remove(idx: number) {
    setList(list.filter((_, i) => i !== idx));
  }
  function move(idx: number, dir: -1 | 1) {
    const t = idx + dir;
    if (t < 0 || t >= list.length) return;
    const next = [...list];
    [next[idx], next[t]] = [next[t], next[idx]];
    setList(next);
  }
  return (
    <SectionShell title="Awards & Honors" count={list.length} onAdd={add}>
      {list.length === 0 ? (
        <Empty>
          No awards yet. The AI hides this section unless you have 3+ wins.
        </Empty>
      ) : null}
      {list.map((a, idx) => (
        <EntryCard
          key={a.id}
          onMoveUp={idx > 0 ? () => move(idx, -1) : undefined}
          onMoveDown={idx < list.length - 1 ? () => move(idx, 1) : undefined}
          onRemove={() => remove(idx)}
        >
          <Field label="Title">
            <input
              className={inputClass()}
              value={a.title}
              onChange={(e) => update(idx, { title: e.target.value })}
              placeholder="1st Place — Hack The North"
            />
          </Field>
          <div className="grid grid-cols-[120px_1fr] gap-2">
            <Field label="Date">
              <input
                className={inputClass()}
                value={a.date ?? ""}
                onChange={(e) =>
                  update(idx, { date: e.target.value || undefined })
                }
                placeholder="Sep 2023"
              />
            </Field>
            <Field label="Detail" hint="optional one-liner">
              <input
                className={inputClass()}
                value={a.detail ?? ""}
                onChange={(e) =>
                  update(idx, { detail: e.target.value || undefined })
                }
                placeholder="Best Hardware Hack · 1500+ participants"
              />
            </Field>
          </div>
        </EntryCard>
      ))}
    </SectionShell>
  );
}

function PublicationsForm({
  doc,
  onPatch,
}: {
  doc: ResumeDoc;
  onPatch: (p: Partial<ResumeDoc>) => void;
}) {
  const list = doc.publications;
  function setList(next: PublicationDocEntry[]) {
    onPatch({ publications: next });
  }
  function update(idx: number, patch: Partial<PublicationDocEntry>) {
    setList(list.map((g, i) => (i === idx ? { ...g, ...patch } : g)));
  }
  function add() {
    setList([
      ...list,
      { id: `pub-${Date.now()}`, citation: "", url: undefined },
    ]);
  }
  function remove(idx: number) {
    setList(list.filter((_, i) => i !== idx));
  }
  function move(idx: number, dir: -1 | 1) {
    const t = idx + dir;
    if (t < 0 || t >= list.length) return;
    const next = [...list];
    [next[idx], next[t]] = [next[t], next[idx]];
    setList(next);
  }
  return (
    <SectionShell title="Publications" count={list.length} onAdd={add}>
      {list.length === 0 ? (
        <Empty>
          No publications. Hidden from the resume by default — show a section
          below if you have research output.
        </Empty>
      ) : null}
      {list.map((p, idx) => (
        <EntryCard
          key={p.id}
          onMoveUp={idx > 0 ? () => move(idx, -1) : undefined}
          onMoveDown={idx < list.length - 1 ? () => move(idx, 1) : undefined}
          onRemove={() => remove(idx)}
        >
          <Field label="Citation" hint="Authors. Title. Venue, Year.">
            <textarea
              className={inputClass("min-h-[60px] py-2")}
              value={p.citation}
              onChange={(e) => update(idx, { citation: e.target.value })}
              rows={2}
              placeholder="Doe J., Smith A. Title. NeurIPS, 2024."
            />
          </Field>
          <Field label="URL">
            <input
              className={inputClass()}
              value={p.url ?? ""}
              onChange={(e) => update(idx, { url: e.target.value || undefined })}
              placeholder="https://arxiv.org/..."
            />
          </Field>
        </EntryCard>
      ))}
    </SectionShell>
  );
}

function SectionVisibilityForm({
  doc,
  onPatch,
}: {
  doc: ResumeDoc;
  onPatch: (p: Partial<ResumeDoc>) => void;
}) {
  const visibleSet = new Set<ResumeSectionKey>(doc.sections.order);
  for (const k of doc.sections.hidden) visibleSet.delete(k);
  const all = doc.sections.order;

  function toggle(key: ResumeSectionKey) {
    const hidden = new Set(doc.sections.hidden);
    if (hidden.has(key)) hidden.delete(key);
    else hidden.add(key);
    onPatch({
      sections: {
        order: doc.sections.order,
        hidden: Array.from(hidden),
      },
    });
  }

  return (
    <SectionShell title="Sections">
      <div className="flex flex-wrap gap-1.5">
        {all.map((key) => {
          const isVisible = !doc.sections.hidden.includes(key);
          return (
            <button
              key={key}
              type="button"
              onClick={() => toggle(key)}
              className={cn(
                "inline-flex items-center gap-1 rounded-md h-7 px-2.5 text-[11px] font-medium",
                "border transition-[background-color,border-color,color] duration-150 ease",
                isVisible
                  ? "border-foreground/20 bg-foreground/[0.04] text-foreground"
                  : "border-border/40 bg-transparent text-muted-foreground/60 line-through",
                "hover:border-foreground/30",
              )}
              aria-pressed={isVisible}
            >
              {sectionLabel(key)}
            </button>
          );
        })}
      </div>
    </SectionShell>
  );
}

function sectionLabel(key: ResumeSectionKey): string {
  switch (key) {
    case "experience":
      return "Experience";
    case "projects":
      return "Projects";
    case "education":
      return "Education";
    case "skills":
      return "Skills";
    case "awards":
      return "Awards";
    case "publications":
      return "Publications";
  }
}

// ──────────────────────────────────────────────────────────────
// Reusable bits
// ──────────────────────────────────────────────────────────────

function EntryCard({
  children,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  children: React.ReactNode;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border/40 bg-foreground/[0.015] px-3 pt-2 pb-3 space-y-2.5",
        "transition-[border-color] duration-150 ease",
        "hover:border-border/60",
      )}
    >
      <div className="flex items-center justify-end gap-1">
        {onMoveUp ? (
          <IconBtn
            icon={ArrowUp01Icon}
            onClick={onMoveUp}
            ariaLabel="Move up"
          />
        ) : null}
        {onMoveDown ? (
          <IconBtn
            icon={ArrowDown01Icon}
            onClick={onMoveDown}
            ariaLabel="Move down"
          />
        ) : null}
        <IconBtn icon={Delete02Icon} onClick={onRemove} ariaLabel="Remove" />
      </div>
      {children}
    </div>
  );
}

function IconBtn({
  icon,
  onClick,
  ariaLabel,
}: {
  icon: React.ComponentProps<typeof HugeiconsIcon>["icon"];
  onClick: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center justify-center size-7 rounded-md",
        "text-muted-foreground/70 hover:text-foreground hover:bg-foreground/[0.04]",
        "transition-[background-color,color] duration-150 ease",
        "min-h-9 min-w-9",
      )}
      aria-label={ariaLabel}
    >
      <HugeiconsIcon icon={icon} size={13} strokeWidth={2} />
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[12px] text-muted-foreground/70 italic px-1">
      {children}
    </p>
  );
}

function BulletsInput({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const text = value.join("\n");
  return (
    <textarea
      className={inputClass("min-h-[88px] py-2 leading-relaxed")}
      value={text}
      onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
        const lines = e.target.value
          .split("\n")
          .map((s) => s.replace(/^[•\-*]\s*/, "").trim());
        // Preserve the trailing empty line while editing so the cursor
        // doesn't jump — only filter when we hand to onChange.
        onChange(lines.filter((s) => s.length > 0).slice(0, 8));
      }}
      placeholder={placeholder}
      rows={4}
    />
  );
}

// ──────────────────────────────────────────────────────────────
// Preview
// ──────────────────────────────────────────────────────────────

function PreviewPane({
  doc,
  fitTier,
  onMeasure,
}: {
  doc: ResumeDoc;
  fitTier: FitTier;
  onMeasure: (heightPx: number) => void;
}) {
  // Watch the rendered .resume-doc element's actual height so the
  // editor's fit indicator reflects reality, not a heuristic. The
  // ResizeObserver fires on every content change, font load, etc.
  // Transforms (the scale 0.78x) don't affect layout dimensions, so
  // scrollHeight gives us the natural page-equivalent pixels.
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const article = wrapper.querySelector<HTMLElement>(".resume-doc");
    if (!article) return;
    const measure = () => onMeasure(article.scrollHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(article);
    return () => ro.disconnect();
  }, [doc, onMeasure]);

  return (
    <div className="bg-foreground/[0.015] dark:bg-foreground/[0.04] hidden lg:block lg:overflow-y-auto lg:max-h-[calc(100svh-3.5rem-3.5rem)] gs-pane-scroll">
      {/* Plain <style> tag with dangerouslySetInnerHTML — styled-jsx
          silently drops `<style jsx global>{`${dynamicString}`}` when
          the template literal contains only an interpolation, which
          was eating every resume rule and making the preview render
          as plain text. */}
      <style dangerouslySetInnerHTML={{ __html: RESUME_PRINT_CSS }} />
      <div className="flex justify-center px-6 py-8">
        <div
          className="origin-top relative"
          style={{
            transform: "scale(var(--resume-scale, 0.78))",
            transformOrigin: "top center",
          }}
        >
          {/* Page-break guide at the 11in mark. Lives inside the
              scaled wrapper so it tracks the resume's coordinate
              space. The line + label only render when content
              actually crosses the boundary — when everything fits,
              there's no overflow to flag. */}
          <PageBreakGuide overflowing={fitTier === "over"} />
          <div ref={wrapperRef}>
            <PrintableResume doc={doc} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

function mergeShallowDeep(
  base: ResumeDoc,
  patch: Partial<ResumeDoc>,
): ResumeDoc {
  const out = { ...base } as ResumeDoc;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      // biome-ignore lint/suspicious/noExplicitAny: dynamic merge
      (out as any)[k] = v;
      continue;
    }
    if (v && typeof v === "object") {
      // biome-ignore lint/suspicious/noExplicitAny: dynamic merge
      (out as any)[k] = { ...(base as any)[k], ...v };
      continue;
    }
    // biome-ignore lint/suspicious/noExplicitAny: dynamic merge
    (out as any)[k] = v;
  }
  return out;
}

function humanizeError(code?: string): string {
  switch (code) {
    case "no_doc":
      return "Resume not found";
    case "invalid_patch":
      return "Some fields are too long or malformed";
    case "no_resume":
      return "Run a portfolio scan first";
    case "ai_not_configured":
      return "AI not configured";
    case "browser_not_bound":
      return "PDF service unavailable";
    case "generation_failed":
      return "AI couldn't generate the resume";
    case "regen_failed":
      return "Couldn't regenerate bullets";
    case "pdf_render_failed":
      return "PDF render failed";
    default:
      return code || "Save failed";
  }
}
