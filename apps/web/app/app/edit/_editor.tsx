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
  { id: "theme", label: "Theme" },
  { id: "layout", label: "Layout" },
];

const SAVE_DEBOUNCE_MS = 700;

type SaveStatus = "idle" | "saving" | "saved" | "error";

export function Editor({
  initialResume,
  handle,
}: {
  initialResume: Resume;
  handle: string;
}) {
  const [resume, setResume] = useState<Resume>(initialResume);
  const [active, setActive] = useState<SectionId>("hero");
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishMsg, setPublishMsg] = useState<string | null>(null);
  // Queue of patches we haven't flushed yet. Aggregating them means we
  // don't send 5 PATCHes for 5 keystrokes in the same field.
  const pendingPatchRef = useRef<Record<string, unknown>>({});
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<boolean>(false);

  const flush = useCallback(async () => {
    const patch = pendingPatchRef.current;
    if (Object.keys(patch).length === 0) return;
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
        const err = (await resp.json().catch(() => ({}))) as { error?: string };
        setStatus("error");
        setErrorMsg(err.error ?? "Save failed");
        return;
      }
      const data = (await resp.json()) as { resume: Resume };
      setResume(data.resume);
      setStatus("saved");
      setErrorMsg(null);
    } catch {
      setStatus("error");
      setErrorMsg("Network error.");
    } finally {
      inFlightRef.current = false;
      // If more patches arrived while we were in flight, kick another.
      if (Object.keys(pendingPatchRef.current).length > 0) {
        queueFlush();
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
      pendingPatchRef.current = {
        ...pendingPatchRef.current,
        ...patch,
      };
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
        setPublishMsg(`Published · gitshow.io/${handle}`);
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

function Header({
  handle,
  status,
  errorMsg,
  onSaveNow,
  publishing,
  onPublish,
  publishMsg,
}: {
  handle: string;
  status: SaveStatus;
  errorMsg: string | null;
  onSaveNow: () => void;
  publishing: boolean;
  onPublish: () => void;
  publishMsg: string | null;
}) {
  return (
    <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <Link
          href="/app"
          className="inline-flex items-center gap-2 text-[12px] text-muted-foreground hover:text-foreground transition-colors border border-border/40 rounded-lg pl-1 pr-2 py-1"
          aria-label="Back to dashboard"
        >
          <LogoMark size={18} />
          <span>← /app</span>
        </Link>
        <span className="text-[13px] text-muted-foreground">
          Editing draft for <span className="font-mono text-foreground">@{handle}</span>
        </span>
        <SaveStatusDot status={status} errorMsg={errorMsg} onSaveNow={onSaveNow} />
      </div>
      <div className="flex items-center gap-2 sm:justify-end">
        <Link
          href="/app/preview"
          target="_blank"
          className="inline-flex items-center rounded-xl border border-border/40 bg-card/30 px-3 py-2 text-[13px] text-muted-foreground hover:text-foreground hover:bg-card/50 transition-colors min-h-11"
        >
          Preview ↗
        </Link>
        <button
          type="button"
          onClick={onPublish}
          disabled={publishing}
          className="inline-flex items-center rounded-xl bg-foreground text-background px-4 py-2 text-[13px] font-medium hover:opacity-90 transition-opacity min-h-11 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {publishing ? "Publishing…" : "Publish"}
        </button>
      </div>
      {publishMsg ? (
        <span className="text-[11px] text-muted-foreground sm:w-full sm:text-right">
          {publishMsg}
        </span>
      ) : null}
    </header>
  );
}

function SaveStatusDot({
  status,
  errorMsg,
  onSaveNow,
}: {
  status: SaveStatus;
  errorMsg: string | null;
  onSaveNow: () => void;
}) {
  const label =
    status === "saving"
      ? "Saving…"
      : status === "saved"
        ? "Saved"
        : status === "error"
          ? errorMsg ?? "Save error"
          : "";
  const color =
    status === "saving"
      ? "bg-[var(--primary)]"
      : status === "saved"
        ? "bg-emerald-500"
        : status === "error"
          ? "bg-[var(--destructive)]"
          : "bg-muted-foreground";

  return (
    <div
      className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
      role="status"
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          color,
          status === "saving" && "gs-pulse",
        )}
      />
      <span>{label || "Idle"}</span>
      {status === "error" ? (
        <button
          type="button"
          onClick={onSaveNow}
          className="ml-1 underline underline-offset-2 hover:text-foreground"
        >
          Retry
        </button>
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
                "w-full text-left rounded-lg px-3 py-2 text-[13px] transition-colors",
                tab.id === active
                  ? "bg-card text-foreground border border-border/60"
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
    case "theme":
      return <ThemeSectionForm resume={resume} onPatch={onPatch} />;
    case "layout":
      return <LayoutSectionForm resume={resume} onPatch={onPatch} />;
    default:
      return null;
  }
}
