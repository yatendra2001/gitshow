"use client";

/**
 * Per-resume editor — `/app/resume/[id]`.
 *
 * Every resume in gitshow is JD-tied; this is the editor for one of
 * them. Form on the left, live preview on the right, autosaving each
 * keystroke (debounced) to `/api/resume/tailored/[id]`.
 *
 * State model:
 *   - `doc` is the single source of truth for the form.
 *   - Each form change calls `onPatch(partial)` which:
 *       1. Optimistically merges into local state.
 *       2. Queues a debounced PATCH /api/resume/tailored/[id].
 *       3. Reconciles the server response back into local state.
 *   - "Download PDF" POSTs the current doc to /api/resume/doc/pdf.
 *
 * Animation policy: every transition specifies its property, 150ms
 * ease-out for hover, 200ms for entrance. No layout shift on dynamic
 * numbers (tabular-nums on the page-fit indicator).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  Delete02Icon,
  Tick02Icon,
  AlertCircleIcon,
  ArrowUp01Icon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  Loading03Icon,
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
import { estimateContentLines } from "@gitshow/shared/resume-doc";
import type {
  TailoredResume,
  TailoredResumeMeta,
} from "@gitshow/shared/tailored-resume";
import { tailoredDisplayLabel } from "@gitshow/shared/tailored-resume";
import { cn } from "@/lib/utils";
import { ResumePdfDownloadButton } from "@/components/resume/download-pdf-button";
import {
  ResumePreview,
  type ResumePageFit,
} from "@/components/resume/preview-pane";
import { ResumeFitChip } from "@/components/resume/fit-chip";

const SAVE_DEBOUNCE_MS = 700;

type Status = "idle" | "saving" | "saved" | "error";

export function ResumeEditor({
  initialTailored,
}: {
  initialTailored: TailoredResume;
}) {
  const router = useRouter();
  const [meta, setMeta] = useState<TailoredResumeMeta>(initialTailored.meta);
  const [doc, setDoc] = useState<ResumeDoc>(initialTailored.doc);
  const [status, setStatus] = useState<Status>("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const pendingRef = useRef<Partial<ResumeDoc>>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const [pageFit, setPageFit] = useState<ResumePageFit | null>(null);

  const tailoredId = meta.id;
  const patchUrl = `/api/resume/tailored/${tailoredId}`;

  const flush = useCallback(async () => {
    const patch = pendingRef.current;
    if (!hasPatch(patch) || inFlightRef.current) return;
    pendingRef.current = {};
    inFlightRef.current = true;
    setStatus("saving");
    try {
      const resp = await fetch(patchUrl, {
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
      const data = (await resp.json()) as { tailored: TailoredResume };
      const queuedPatch = pendingRef.current;
      const hasQueuedPatch = hasPatch(queuedPatch);
      setDoc(
        hasQueuedPatch
          ? mergeShallowDeep(data.tailored.doc, queuedPatch)
          : data.tailored.doc,
      );
      setMeta(data.tailored.meta);
      setStatus(hasQueuedPatch ? "saving" : "saved");
      setErrMsg(null);
      if (!hasQueuedPatch) {
        setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 1200);
      }
    } catch {
      setStatus("error");
      setErrMsg("Network error");
    } finally {
      inFlightRef.current = false;
      if (hasPatch(pendingRef.current)) {
        timerRef.current = setTimeout(flush, 50);
      }
    }
  }, [patchUrl]);

  const onPatch = useCallback(
    (patch: Partial<ResumeDoc>) => {
      // Optimistic merge — the server validates on PATCH and bumps meta.
      setDoc((prev) => mergeShallowDeep(prev, patch));
      pendingRef.current = mergePatch(pendingRef.current, patch);
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

  const lineCount = useMemo(() => estimateContentLines(doc), [doc]);

  const onDownloadError = useCallback((msg: string) => {
    setStatus("error");
    setErrMsg(msg);
  }, []);

  const onDelete = useCallback(async () => {
    if (deleting) return;
    setDeleting(true);
    setErrMsg(null);
    try {
      const resp = await fetch(`/api/resume/tailored/${tailoredId}`, {
        method: "DELETE",
      });
      if (!resp.ok) {
        const body = (await resp.json().catch(() => ({}))) as {
          error?: string;
          detail?: string;
        };
        setStatus("error");
        setErrMsg(body.detail || humanizeError(body.error));
        setDeleting(false);
        return;
      }
      router.push("/app/resume");
      router.refresh();
    } catch {
      setStatus("error");
      setErrMsg("Delete failed");
      setDeleting(false);
    }
  }, [tailoredId, deleting, router]);

  // Filename stem combines the candidate name and the JD target so the
  // saved PDF is recognisable in the user's downloads folder.
  const filenameStem = useMemo(() => {
    const namePart = (doc.header.name || "resume")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-");
    const tagPart = (meta.company || meta.jobTitle || "tailored")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-");
    return `${namePart}-${tagPart}`;
  }, [doc.header.name, meta.company, meta.jobTitle]);

  const displayLabel = tailoredDisplayLabel(meta);

  return (
    <div className="flex flex-col min-h-[calc(100svh-3.5rem)]">
      <EditorToolbar
        label={displayLabel}
        trailing={
          <>
            <ResumeFitChip fit={pageFit} estimatedLines={lineCount} />
            <SaveBadge status={status} errMsg={errMsg} />
            {deleteConfirm ? (
              <InlineDeleteConfirm
                onCancel={() => setDeleteConfirm(false)}
                onConfirm={onDelete}
                deleting={deleting}
              />
            ) : (
              <button
                type="button"
                onClick={() => setDeleteConfirm(true)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md h-8 px-2.5 text-[12px]",
                  "text-muted-foreground hover:text-[var(--destructive)] hover:bg-[var(--destructive)]/[0.08]",
                  "transition-[background-color,color] duration-150 ease",
                  "min-h-9",
                )}
                aria-label="Delete this resume"
              >
                <HugeiconsIcon icon={Delete02Icon} size={12} strokeWidth={2} />
                <span className="hidden sm:inline">Delete</span>
              </button>
            )}
            <ResumePdfDownloadButton
              doc={doc}
              filenameStem={filenameStem}
              onError={onDownloadError}
            />
          </>
        }
      />

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[minmax(0,520px)_minmax(0,1fr)]">
        {/* Form pane */}
        <div className="border-r border-border/30 lg:overflow-y-auto lg:max-h-[calc(100svh-3.5rem-3.5rem)] gs-pane-scroll">
          <div className="px-5 py-6 space-y-6">
            <AtsCaption />
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

        {/* Preview pane — shared component owns measurement + overflow marker */}
        <div className="bg-foreground/[0.015] dark:bg-foreground/[0.04] hidden lg:block lg:overflow-y-auto lg:max-h-[calc(100svh-3.5rem-3.5rem)] gs-pane-scroll">
          <ResumePreview doc={doc} onFitChange={setPageFit} />
        </div>
      </div>
    </div>
  );
}

/**
 * Editor-specific toolbar — back link + resume label on the left,
 * page-actions slot on the right. The shared `ResumeShellToolbar` is
 * tabbed (Resume / Tailored versions), but with the JD-first
 * restructure there's only one concept — so this toolbar drops the
 * tabs and adds the `← Resumes` back link instead.
 */
function EditorToolbar({
  label,
  trailing,
}: {
  label: string;
  trailing: React.ReactNode;
}) {
  return (
    <div className="sticky top-14 z-10 flex items-center gap-3 border-b border-border/30 bg-background/85 backdrop-blur px-5 h-14">
      <Link
        href="/app/resume"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md h-8 px-2 -ml-1 text-[12.5px]",
          "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]",
          "transition-[background-color,color] duration-150 ease",
          "min-h-9 outline-none focus-visible:ring-2 focus-visible:ring-foreground/20",
        )}
        aria-label="Back to resumes"
      >
        <HugeiconsIcon icon={ArrowLeft01Icon} size={13} strokeWidth={2} />
        <span className="hidden sm:inline">Resumes</span>
      </Link>
      <span aria-hidden className="text-muted-foreground/30">
        /
      </span>
      <h1 className="truncate text-[13px] font-medium tracking-tight">
        {label}
      </h1>
      <div className="ml-auto flex items-center gap-2">{trailing}</div>
    </div>
  );
}

function InlineDeleteConfirm({
  onCancel,
  onConfirm,
  deleting,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  deleting: boolean;
}) {
  return (
    <>
      <span className="hidden sm:inline-block text-[12px] text-muted-foreground">
        Delete this resume?
      </span>
      <button
        type="button"
        onClick={onCancel}
        disabled={deleting}
        className={cn(
          "inline-flex items-center rounded-md h-8 px-2.5 text-[12px]",
          "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]",
          "transition-[background-color,color] duration-150 ease",
          "min-h-9",
        )}
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onConfirm}
        disabled={deleting}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md h-8 px-3 text-[12px] font-medium",
          "bg-[var(--destructive)] text-white",
          "transition-[opacity] duration-150 ease",
          "hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed",
          "min-h-9",
        )}
      >
        <HugeiconsIcon
          icon={deleting ? Loading03Icon : Delete02Icon}
          size={12}
          strokeWidth={2}
          className={deleting ? "animate-spin" : undefined}
        />
        {deleting ? "Deleting" : "Confirm delete"}
      </button>
    </>
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

/**
 * Slim ATS reassurance line. Earlier iterations used a full-bleed
 * info card here — useful on visit #1, noise from visit #2 onward.
 * One muted line is enough; the full guarantees live in marketing.
 */
function AtsCaption() {
  return (
    <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <HugeiconsIcon
        icon={Tick02Icon}
        size={11}
        strokeWidth={2.25}
        className="shrink-0 text-foreground/60"
      />
      <span>
        ATS-safe · single-column · standard fonts · plain bullets
      </span>
    </p>
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
  const normalizedText = value.join("\n");
  const [draft, setDraft] = useState(normalizedText);
  const lastNormalizedTextRef = useRef(normalizedText);

  useEffect(() => {
    if (normalizedText === lastNormalizedTextRef.current) return;
    lastNormalizedTextRef.current = normalizedText;
    setDraft(normalizedText);
  }, [normalizedText]);

  return (
    <textarea
      className={inputClass("min-h-[88px] py-2 leading-relaxed")}
      value={draft}
      onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
        const nextDraft = e.target.value;
        const nextValue = normalizeBulletDraft(nextDraft);
        setDraft(nextDraft);
        if (sameStringArray(nextValue, value)) return;
        lastNormalizedTextRef.current = nextValue.join("\n");
        onChange(nextValue);
      }}
      placeholder={placeholder}
      rows={4}
    />
  );
}

function normalizeBulletDraft(text: string): string[] {
  return text
    .split("\n")
    .map((s) => s.replace(/^[•\-*]\s*/, "").trim())
    .filter((s) => s.length > 0)
    .slice(0, 8);
}

function sameStringArray(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, idx) => value === b[idx]);
}

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

function hasPatch(patch: Partial<ResumeDoc>): boolean {
  return Object.keys(patch).length > 0;
}

function mergePatch(
  base: Partial<ResumeDoc>,
  patch: Partial<ResumeDoc>,
): Partial<ResumeDoc> {
  return { ...base, ...patch };
}

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
    case "not_found":
      return "Resume not found";
    case "invalid_patch":
      return "Some fields are too long or malformed";
    case "browser_not_bound":
      return "PDF service unavailable";
    case "pdf_render_failed":
      return "PDF render failed";
    case "delete_failed":
      return "Delete failed";
    case "payment_required":
      return "A Pro subscription is required";
    default:
      return code || "Save failed";
  }
}
