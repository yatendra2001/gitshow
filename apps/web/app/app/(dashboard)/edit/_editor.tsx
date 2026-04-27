"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Resume } from "@gitshow/shared/resume";
import { cn } from "@/lib/utils";
import { LogoMark } from "@/components/logo";
import {
  AboutSectionForm,
  BlogSectionForm,
  BuildLogSectionForm,
  ContactSectionForm,
  EducationSectionForm,
  HeroSectionForm,
  LayoutSectionForm,
  ProjectsSectionForm,
  SkillsSectionForm,
  TemplateSectionForm,
  ThemeSectionForm,
  WorkSectionForm,
} from "./_sections";

/**
 * Editor shell.
 *
 * Architecture:
 *   - Single source of truth lives in `resume` local state.
 *   - Every form calls `onPatch(partial)` which merges shallow-deeply
 *     into local state AND queues a debounced PATCH /api/resume/draft.
 *   - Server bumps `meta.version` + `meta.updatedAt` on each write; the
 *     response is reconciled back into local state so we don't diverge.
 *   - "Regenerate with AI" spawns a targeted Fly scan (section-scoped).
 *   - "Publish" promotes draft → published.
 *
 * Design tradeoff: we don't show section-level save status — one global
 * indicator. In practice that's clearer than 10 spinners.
 */

type SectionId =
  | "hero"
  | "about"
  | "work"
  | "education"
  | "skills"
  | "projects"
  | "buildLog"
  | "contact"
  | "blog"
  | "template"
  | "theme"
  | "layout";

interface Tab {
  id: SectionId;
  label: string;
}

const TABS: Tab[] = [
  { id: "hero", label: "Hero" },
  { id: "about", label: "About" },
  { id: "work", label: "Work" },
  { id: "education", label: "Education" },
  { id: "skills", label: "Skills" },
  { id: "projects", label: "Projects" },
  { id: "buildLog", label: "Build log" },
  { id: "contact", label: "Contact" },
  { id: "blog", label: "Blog" },
  { id: "template", label: "Template" },
  { id: "theme", label: "Theme" },
  { id: "layout", label: "Layout" },
];

const SAVE_DEBOUNCE_MS = 700;

type SaveStatus = "idle" | "saving" | "saved" | "error";

export function Editor({
  initialResume,
  handle,
  initialPublished = false,
}: {
  initialResume: Resume;
  handle: string;
  initialPublished?: boolean;
}) {
  const [resume, setResume] = useState<Resume>(initialResume);
  const [active, setActive] = useState<SectionId>("hero");
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishMsg, setPublishMsg] = useState<string | null>(null);
  const [hasPublished, setHasPublished] = useState<boolean>(initialPublished);
  // Queue of patches we haven't flushed yet. Aggregating them means we
  // don't send 5 PATCHes for 5 keystrokes in the same field.
  const pendingPatchRef = useRef<Partial<Resume>>({});
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<boolean>(false);

  const flush = useCallback(async () => {
    const patch = pendingPatchRef.current;
    if (!hasPatch(patch)) return;
    if (inFlightRef.current) return;

    pendingPatchRef.current = {};
    inFlightRef.current = true;
    setStatus("saving");

    try {
      const resp = await fetch("/api/resume/draft", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patch }),
      });
      if (!resp.ok) {
        const err = (await resp.json().catch(() => ({}))) as {
          error?: string;
        };
        setStatus("error");
        setErrorMsg(humanizeSaveError(err.error));
        return;
      }
      const data = (await resp.json()) as { resume: Resume };
      const queuedPatch = pendingPatchRef.current;
      const hasQueuedPatch = hasPatch(queuedPatch);
      setResume(
        hasQueuedPatch ? mergeResumePatch(data.resume, queuedPatch) : data.resume,
      );
      setStatus(hasQueuedPatch ? "saving" : "saved");
      setErrorMsg(null);
    } catch {
      setStatus("error");
      setErrorMsg("Network error.");
    } finally {
      inFlightRef.current = false;
      // If more patches arrived while we were in flight, kick another.
      if (hasPatch(pendingPatchRef.current)) {
        saveTimerRef.current = setTimeout(() => void flush(), 50);
      }
    }
  }, []);

  const queueFlush = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
  }, [flush]);

  const onPatch = useCallback(
    (patch: Partial<Resume>) => {
      // Update local state optimistically.
      setResume((prev) => ({ ...prev, ...patch }));
      // Accumulate — a later keystroke on the same field just overwrites
      // the earlier value within the same top-level key.
      pendingPatchRef.current = { ...pendingPatchRef.current, ...patch };
      queueFlush();
    },
    [queueFlush],
  );

  const onSaveNow = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    void flush();
  }, [flush]);

  useEffect(() => {
    // Flush on page hide so the user doesn't navigate away with pending edits.
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        void flush();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [flush]);

  const onPublish = useCallback(async () => {
    if (publishing) return;
    // Make sure any pending edits land first.
    await flush();
    setPublishing(true);
    setPublishMsg(null);
    try {
      const resp = await fetch("/api/profile/publish-resume", {
        method: "POST",
      });
      if (!resp.ok) {
        const err = (await resp.json().catch(() => ({}))) as {
          error?: string;
        };
        setPublishMsg(`Publish failed: ${err.error ?? "unknown"}`);
      } else {
        setHasPublished(true);
        setPublishMsg("Published ✓");
        setTimeout(() => setPublishMsg(null), 4000);
      }
    } catch {
      setPublishMsg("Network error publishing.");
    } finally {
      setPublishing(false);
    }
  }, [publishing, flush, handle]);

  const activeTab = useMemo(
    () => TABS.find((t) => t.id === active) ?? TABS[0],
    [active],
  );

  return (
    <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 py-6 flex flex-col gap-5">
      <Header
        handle={handle}
        status={status}
        errorMsg={errorMsg}
        onSaveNow={onSaveNow}
        publishing={publishing}
        onPublish={onPublish}
        publishMsg={publishMsg}
        hasPublished={hasPublished}
      />

      <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-5">
        <Sidebar active={active} onSelect={setActive} />

        <div className="rounded-2xl border border-border/40 bg-card/40 p-5 sm:p-6 min-h-[60vh]">
          <div className="flex items-start justify-between gap-3 mb-5">
            <div className="flex flex-col gap-1">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
                Editing
              </div>
              <h2 className="text-[18px] font-semibold">{activeTab.label}</h2>
            </div>
          </div>

          <SectionView
            id={active}
            resume={resume}
            handle={handle}
            onPatch={onPatch}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Collapse raw PATCH error codes from /api/resume/draft into a friendly
 * one-liner. `invalid_patch` is the most common — it fires when the Zod
 * schema rejects the merged draft (usually a URL field that got a
 * relative path before the schema knew to accept one). The title
 * attribute on the pill still shows the raw code for debugging.
 */
function humanizeSaveError(code: string | undefined): string {
  switch (code) {
    case "invalid_patch":
      return "Some fields didn't fit the schema";
    case "no_draft":
      return "Draft missing — rerun the scan";
    case "unauthenticated":
      return "Signed out";
    case "r2_not_bound":
      return "Storage unavailable";
    default:
      return code ?? "Save failed";
  }
}

function hasPatch(patch: Partial<Resume>): boolean {
  return Object.keys(patch).length > 0;
}

function mergeResumePatch(base: Resume, patch: Partial<Resume>): Resume {
  const next: Resume = { ...base };
  for (const key of Object.keys(patch) as Array<keyof Resume>) {
    const value = patch[key];
    if (value !== undefined) {
      Object.assign(next, { [key]: value });
    }
  }
  return next;
}

function Header({
  handle,
  status,
  errorMsg,
  onSaveNow,
  publishing,
  onPublish,
  publishMsg,
  hasPublished,
}: {
  handle: string;
  status: SaveStatus;
  errorMsg: string | null;
  onSaveNow: () => void;
  publishing: boolean;
  onPublish: () => void;
  publishMsg: string | null;
  hasPublished: boolean;
}) {
  return (
    <header className="flex flex-col gap-3">
      {/* Row 1 — back link + actions. Intentionally the only full-width
          row; every other piece of header chrome drops into a subtle
          meta row below so the action buttons aren't crowded. */}
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/app"
          className="group inline-flex items-center gap-2 text-[12px] text-muted-foreground border border-border/40 rounded-lg pl-1 pr-2 py-1 select-none transition-[background-color,border-color,color,transform] duration-[140ms] ease-[cubic-bezier(0.4,0,0.2,1)] hover:text-foreground hover:bg-foreground/[0.04] hover:border-foreground/25 active:scale-[0.97] active:duration-[80ms] outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          aria-label="Back to dashboard"
        >
          <LogoMark size={18} />
          <span>← /app</span>
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href="/app/preview"
            target="_blank"
            className="inline-flex items-center min-h-10 rounded-xl border border-border/40 bg-card/30 px-3 py-2 text-[13px] text-muted-foreground select-none transition-[background-color,border-color,color,transform] duration-[140ms] ease-[cubic-bezier(0.4,0,0.2,1)] hover:text-foreground hover:bg-card/50 hover:border-foreground/25 active:scale-[0.97] active:duration-[80ms] outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Preview ↗
          </Link>
          <button
            type="button"
            onClick={onPublish}
            disabled={publishing}
            className="inline-flex items-center min-h-10 rounded-xl bg-foreground text-background px-4 py-2 text-[13px] font-medium select-none shadow-[inset_0_1px_0_rgb(255_255_255_/_0.10),0_1px_2px_-1px_oklch(0_0_0_/_0.20)] transition-[background-color,box-shadow,transform,opacity] duration-[140ms] ease-[cubic-bezier(0.4,0,0.2,1)] hover:shadow-[inset_0_1px_0_rgb(255_255_255_/_0.14),0_2px_8px_-3px_oklch(0_0_0_/_0.24)] active:scale-[0.97] active:duration-[80ms] outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100"
          >
            {publishing ? (
              <span className="inline-flex items-center gap-2">
                <span aria-hidden className="size-3 rounded-full border-[1.5px] border-background/40 border-t-background animate-spin" />
                <span className="tabular">Publishing…</span>
              </span>
            ) : (
              "Publish"
            )}
          </button>
        </div>
      </div>

      {/* Row 2 — context title. Clear statement of what the user is editing. */}
      <div className="flex items-baseline gap-2">
        <span className="text-[13px] text-muted-foreground">Editing draft for</span>
        <span className="font-mono text-[14px] text-foreground">@{handle}</span>
      </div>

      {/* Row 3 — subtle meta row for save state + published URL. No more
          inline error+retry crowding the action buttons. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <SaveStatusPill status={status} errorMsg={errorMsg} onSaveNow={onSaveNow} />
        {publishMsg ? (
          <span className="text-foreground/90">{publishMsg}</span>
        ) : hasPublished ? (
          <span>
            Live at{" "}
            <Link
              href={`/${handle}`}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-foreground hover:underline underline-offset-2"
            >
              gitshow.io/{handle}
            </Link>
          </span>
        ) : null}
      </div>
    </header>
  );
}

function SaveStatusPill({
  status,
  errorMsg,
  onSaveNow,
}: {
  status: SaveStatus;
  errorMsg: string | null;
  onSaveNow: () => void;
}) {
  // Human-readable save state. Raw API error codes like "invalid_patch"
  // aren't helpful to the user — collapse them into a friendlier line
  // + a Retry affordance.
  const label =
    status === "saving"
      ? "Saving…"
      : status === "saved"
        ? "Saved"
        : status === "error"
          ? "Couldn't save"
          : "Idle";
  const color =
    status === "saving"
      ? "bg-[var(--primary)]"
      : status === "saved"
        ? "bg-emerald-500"
        : status === "error"
          ? "bg-[var(--destructive)]"
          : "bg-muted-foreground/60";

  return (
    <div className="flex items-center gap-1.5" role="status">
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          color,
          status === "saving" && "gs-pulse",
        )}
      />
      <span className={status === "error" ? "text-[var(--destructive)]" : ""}>
        {label}
      </span>
      {status === "error" ? (
        <>
          <button
            type="button"
            onClick={onSaveNow}
            className="underline underline-offset-2 hover:text-foreground"
          >
            Retry
          </button>
          {errorMsg ? (
            <span
              className="text-muted-foreground/70 truncate max-w-[260px]"
              title={errorMsg}
            >
              · {errorMsg}
            </span>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function Sidebar({
  active,
  onSelect,
}: {
  active: SectionId;
  onSelect: (s: SectionId) => void;
}) {
  return (
    <nav className="md:sticky md:top-6 self-start">
      <ul className="flex md:flex-col gap-1 overflow-x-auto md:overflow-x-visible">
        {TABS.map((tab) => (
          <li key={tab.id} className="shrink-0">
            <button
              type="button"
              onClick={() => onSelect(tab.id)}
              aria-current={tab.id === active ? "true" : undefined}
              className={cn(
                "w-full text-left rounded-lg px-3 py-2 text-[13px] select-none",
                "transition-[background-color,border-color,color,transform] duration-[140ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
                "active:scale-[0.98] active:duration-[80ms]",
                "outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset",
                tab.id === active
                  ? "bg-card text-foreground border border-border/60 shadow-[0_1px_2px_-1px_oklch(0_0_0_/_0.06)]"
                  : "text-muted-foreground hover:text-foreground hover:bg-card/40",
              )}
            >
              {tab.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function SectionView({
  id,
  resume,
  handle,
  onPatch,
}: {
  id: SectionId;
  resume: Resume;
  handle: string;
  onPatch: (patch: Partial<Resume>) => void;
}) {
  switch (id) {
    case "hero":
      return <HeroSectionForm resume={resume} onPatch={onPatch} />;
    case "about":
      return <AboutSectionForm resume={resume} onPatch={onPatch} />;
    case "work":
      return <WorkSectionForm resume={resume} onPatch={onPatch} />;
    case "education":
      return <EducationSectionForm resume={resume} onPatch={onPatch} />;
    case "skills":
      return <SkillsSectionForm resume={resume} onPatch={onPatch} />;
    case "projects":
      return <ProjectsSectionForm resume={resume} onPatch={onPatch} />;
    case "buildLog":
      return <BuildLogSectionForm resume={resume} onPatch={onPatch} />;
    case "contact":
      return <ContactSectionForm resume={resume} onPatch={onPatch} />;
    case "blog":
      return (
        <BlogSectionForm resume={resume} onPatch={onPatch} handle={handle} />
      );
    case "template":
      return <TemplateSectionForm resume={resume} onPatch={onPatch} />;
    case "theme":
      return <ThemeSectionForm resume={resume} onPatch={onPatch} />;
    case "layout":
      return <LayoutSectionForm resume={resume} onPatch={onPatch} />;
    default:
      return null;
  }
}
