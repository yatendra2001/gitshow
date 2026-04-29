"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown, Loader2, Sparkles, X } from "lucide-react";
import type { Resume, TemplateId } from "@gitshow/shared/resume";
import { DataProvider } from "@/components/data-provider";
import {
  TEMPLATES,
  getTemplateComponent,
  getTemplateMeta,
} from "@/components/templates";

/**
 * Owner-only draft preview wrapper.
 *
 * Layout:
 *   - Sticky top strip below the dashboard topbar carrying the templates
 *     trigger (with current selection inline), draft / handle context,
 *     and save actions when there's a pending change. One bar, one
 *     place to look — no "Pick a template below ↓" indirection to the
 *     old floating bottom-right cluster.
 *   - Below the strip, the chosen template renders full-bleed.
 *
 * Picking a template tile previews live without saving; Save draft /
 * Save & (re)publish in the strip persist the choice. Switching
 * templates costs zero data loss because every variant renders the
 * same Resume.
 */
export function TemplatePreview({
  initialResume,
  handle,
  isPublished,
}: {
  initialResume: Resume;
  handle: string;
  isPublished: boolean;
}) {
  const [resume, setResume] = useState<Resume>(initialResume);
  const [pendingTemplate, setPendingTemplate] = useState<TemplateId>(
    initialResume.theme.template,
  );
  const [savedTemplate, setSavedTemplate] = useState<TemplateId>(
    initialResume.theme.template,
  );
  const [open, setOpen] = useState(false);
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const dirty = pendingTemplate !== savedTemplate;
  const Template = useMemo(
    () => getTemplateComponent(pendingTemplate),
    [pendingTemplate],
  );
  const previewResume: Resume = useMemo(
    () => ({
      ...resume,
      theme: { ...resume.theme, template: pendingTemplate },
    }),
    [resume, pendingTemplate],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const onPick = (id: TemplateId) => {
    setPendingTemplate(id);
    setError(null);
    setJustSaved(false);
    setOpen(false);
  };

  // Picking a template is a publish — there's no useful "draft only"
  // state for a chooser (the user already sees the live preview).
  // Patch the draft (so the resume blob is consistent), then publish
  // and reload so the live URL flips immediately.
  const onSave = () => {
    if (busy) return;
    setError(null);
    startTransition(async () => {
      try {
        const patchResp = await fetch("/api/resume/draft", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            patch: {
              theme: { ...resume.theme, template: pendingTemplate },
            },
          }),
        });
        if (!patchResp.ok) {
          const err = (await patchResp.json().catch(() => ({}))) as {
            error?: string;
          };
          setError(err.error ?? "Couldn't save template");
          return;
        }
        const data = (await patchResp.json()) as { resume: Resume };
        setResume(data.resume);
        setSavedTemplate(data.resume.theme.template);

        const pubResp = await fetch("/api/profile/publish-resume", {
          method: "POST",
        });
        if (!pubResp.ok) {
          const err = (await pubResp.json().catch(() => ({}))) as {
            error?: string;
          };
          setError(err.error ?? "Saved, but publish failed");
          return;
        }
        window.location.reload();
      } catch {
        setError("Network error");
      }
    });
  };

  return (
    <>
      <PreviewStrip
        handle={handle}
        isPublished={isPublished}
        savedTemplate={savedTemplate}
        pendingTemplate={pendingTemplate}
        dirty={dirty}
        busy={busy}
        error={error}
        justSaved={justSaved}
        open={open}
        onOpen={setOpen}
        onPick={onPick}
        onSave={onSave}
      />
      <DataProvider resume={previewResume} handle={handle}>
        <Template />
      </DataProvider>
    </>
  );
}

/* ─────────────────────────  Sticky top strip  ─────────────────────────
 *
 * Visual order:
 *   Draft · @handle · live ↗   …   [ Save draft ] [ Save & republish ]   [ Templates · {name} ▾ ]
 *
 * - Info on the LEFT (low priority context, eye lands here naturally
 *   when reading L→R), Templates trigger on the FAR RIGHT (the action,
 *   right-aligned per dashboard convention). Popover anchors to the
 *   right edge of the trigger so it grows leftward and stays inside
 *   the viewport.
 * - Save / republish only render when `dirty`, slotted between info
 *   and the trigger so they read as a temporary commit step rather
 *   than a permanent affordance. Steady state is just info + trigger.
 * - h-12 + gap-3 sm:gap-4 + mb-3 give the strip room to breathe; the
 *   prior h-10 + gap-2 felt cramped against the topbar.
 */
function PreviewStrip({
  handle,
  isPublished,
  savedTemplate,
  pendingTemplate,
  dirty,
  busy,
  error,
  justSaved,
  open,
  onOpen,
  onPick,
  onSave,
}: {
  handle: string;
  isPublished: boolean;
  savedTemplate: TemplateId;
  pendingTemplate: TemplateId;
  dirty: boolean;
  busy: boolean;
  error: string | null;
  justSaved: boolean;
  open: boolean;
  onOpen: (v: boolean) => void;
  onPick: (id: TemplateId) => void;
  onSave: () => void;
}) {
  return (
    <div className="sticky top-14 z-50 -mx-4 sm:-mx-6 mb-3 border-b border-border/40 bg-background/85 backdrop-blur">
      <div className="flex h-12 items-center gap-3 sm:gap-4 px-4 sm:px-6 lg:px-8">
        <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
          <span className="hidden sm:inline">Draft · </span>
          <span className="text-foreground">@{handle}</span>
          {isPublished ? (
            <>
              {" · "}
              <Link
                href={`/${handle}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-foreground underline-offset-2 hover:underline"
              >
                <span className="hidden sm:inline">live at gitshow.io/</span>
                <span className="sm:hidden">live ↗</span>
                <span className="hidden sm:inline">{handle} ↗</span>
              </Link>
            </>
          ) : (
            <span className="hidden sm:inline"> · not public yet</span>
          )}
        </span>

        <InlineSaveActions
          dirty={dirty}
          busy={busy}
          error={error}
          justSaved={justSaved}
          isPublished={isPublished}
          onSave={onSave}
        />

        <TemplatesTrigger
          savedTemplate={savedTemplate}
          pendingTemplate={pendingTemplate}
          dirty={dirty}
          busy={busy}
          isPublished={isPublished}
          open={open}
          onOpen={onOpen}
          onPick={onPick}
          onSave={onSave}
        />
      </div>
    </div>
  );
}

/* ─────────────────────────  Trigger + popover  ────────────────────── */

function TemplatesTrigger({
  savedTemplate,
  pendingTemplate,
  dirty,
  busy,
  isPublished,
  open,
  onOpen,
  onPick,
  onSave,
}: {
  savedTemplate: TemplateId;
  pendingTemplate: TemplateId;
  dirty: boolean;
  busy: boolean;
  isPublished: boolean;
  open: boolean;
  onOpen: (v: boolean) => void;
  onPick: (id: TemplateId) => void;
  onSave: () => void;
}) {
  const popRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const meta = getTemplateMeta(pendingTemplate);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (popRef.current?.contains(t)) return;
      if (btnRef.current?.contains(t)) return;
      onOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, onOpen]);

  return (
    <div className="relative flex-none">
      <button
        ref={btnRef}
        type="button"
        onClick={() => onOpen(!open)}
        aria-expanded={open}
        aria-label="Pick a template"
        className="group inline-flex h-7 items-center gap-1.5 rounded-full bg-foreground pl-2.5 pr-2 text-background transition-[transform,opacity] duration-[140ms] ease-[cubic-bezier(0.215,0.61,0.355,1)] hover:opacity-90 active:scale-[0.97]"
      >
        <Sparkles className="size-3 opacity-90" />
        <span className="text-[12px] font-medium">Templates</span>
        <span className="hidden text-[11.5px] opacity-70 sm:inline">
          · {meta.name}
        </span>
        <ChevronDown
          className={`size-3 opacity-70 transition-transform duration-[180ms] ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Close is instant — no AnimatePresence/exit. A lingering exit
          let the trigger's `!open` toggle re-open the popover during
          the fade-out, so picking a template or hitting X felt like
          it took a second click to close. */}
      {open && (
        <motion.div
          ref={popRef}
          initial={{ opacity: 0, y: -6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="absolute right-0 top-[calc(100%+8px)] z-[60] w-[min(92vw,540px)] overflow-hidden rounded-2xl border border-border/60 bg-background/95 shadow-[0_30px_60px_-15px_rgba(0,0,0,0.5)] backdrop-blur-xl"
          role="dialog"
          aria-label="Pick a template"
        >
          <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
            <div className="flex items-baseline gap-2">
              <Sparkles className="size-3.5 text-foreground/70" />
              <span className="text-[13px] font-semibold">Templates</span>
              <span className="text-[11.5px] text-muted-foreground">
                · pick a look, preview swaps live
              </span>
            </div>
            <button
              type="button"
              onClick={() => onOpen(false)}
              aria-label="Close"
              className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-card/60 hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3">
            {TEMPLATES.map((t) => {
              const active = t.id === pendingTemplate;
              const saved = t.id === savedTemplate;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onPick(t.id)}
                  title={t.tagline}
                  className={`group relative flex flex-col items-stretch overflow-hidden rounded-xl border text-left transition-all ${
                    active
                      ? "border-foreground/80 ring-2 ring-foreground/15"
                      : "border-border/40 hover:border-border hover:shadow-sm"
                  }`}
                >
                  <TemplateSwatch id={t.id} />
                  <div className="flex items-center justify-between gap-2 bg-card/30 px-2.5 py-1.5">
                    <div className="min-w-0">
                      <div className="truncate text-[12.5px] font-semibold leading-tight">
                        {t.name}
                      </div>
                      <div className="truncate text-[10.5px] leading-tight text-muted-foreground">
                        {t.vibes[0]}
                      </div>
                    </div>
                    {saved && (
                      <span
                        className={`flex size-4 flex-none items-center justify-center rounded-full ${
                          active && saved
                            ? "bg-emerald-500 text-white"
                            : "bg-foreground text-background"
                        }`}
                        title={
                          active && saved
                            ? "Active and saved"
                            : "Currently saved"
                        }
                      >
                        <Check className="size-2.5" strokeWidth={3} />
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-border/40 px-4 py-3">
            <div className="min-w-0 text-[11.5px] text-muted-foreground">
              <span className="font-medium text-foreground/80">
                {meta.name}
              </span>
              <span className="hidden sm:inline"> · {meta.bestFor}</span>
            </div>
            {dirty ? (
              <button
                type="button"
                disabled={busy}
                onClick={onSave}
                className="inline-flex h-8 flex-none items-center gap-1.5 rounded-md bg-foreground px-3 text-[12.5px] font-medium text-background hover:opacity-90 disabled:opacity-60"
              >
                {busy ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    Publishing
                  </>
                ) : isPublished ? (
                  "Save & republish"
                ) : (
                  "Save & publish"
                )}
              </button>
            ) : (
              <span className="inline-flex flex-none items-center gap-1 text-[11.5px] text-muted-foreground">
                <Check className="size-3 text-emerald-500" />
                Saved
              </span>
            )}
          </div>
        </motion.div>
      )}
    </div>
  );
}

/* ─────────────────────────  Inline save actions  ──────────────────── */

function InlineSaveActions({
  dirty,
  busy,
  error,
  justSaved,
  isPublished,
  onSave,
}: {
  dirty: boolean;
  busy: boolean;
  error: string | null;
  justSaved: boolean;
  isPublished: boolean;
  onSave: () => void;
}) {
  const visible = dirty || Boolean(error) || justSaved;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, x: 6 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 6 }}
          transition={{ duration: 0.16, ease: "easeOut" }}
          className="flex flex-none items-center gap-1"
        >
          {error ? (
            <span className="hidden truncate px-1 text-[12px] text-[var(--destructive)] sm:inline">
              {error}
            </span>
          ) : justSaved ? (
            <span className="inline-flex items-center gap-1 px-1 text-[12px] text-emerald-500">
              <Check className="size-3" />
              <span className="hidden sm:inline">Saved</span>
            </span>
          ) : null}
          {dirty && !justSaved && (
            <button
              type="button"
              disabled={busy}
              onClick={onSave}
              className="inline-flex h-7 items-center gap-1.5 rounded-md bg-foreground px-2.5 text-[12px] font-medium text-background hover:opacity-90 disabled:opacity-60"
            >
              {busy ? (
                <>
                  <Loader2 className="size-3 animate-spin" />
                  <span className="hidden sm:inline">
                    {isPublished ? "Republishing" : "Publishing"}
                  </span>
                </>
              ) : (
                <>
                  <span className="sm:hidden">Publish</span>
                  <span className="hidden sm:inline">
                    {isPublished ? "Save & republish" : "Save & publish"}
                  </span>
                </>
              )}
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ─────────────────────────  Tiny swatches  ────────────────────────── */

function TemplateSwatch({ id }: { id: TemplateId }) {
  const meta = getTemplateMeta(id);
  const { bg, fg, accent } = meta.swatch;

  if (id === "classic") {
    return (
      <div className="aspect-[4/3] flex flex-col gap-1 p-1.5" style={{ background: bg }}>
        <div className="flex gap-1 items-center">
          <div className="size-1.5 rounded-full" style={{ background: fg, opacity: 0.8 }} />
          <div className="h-1 flex-1 rounded-full" style={{ background: fg, opacity: 0.4 }} />
        </div>
        <div className="h-0.5 w-2/3 rounded-full" style={{ background: fg, opacity: 0.6 }} />
        <div className="h-0.5 w-1/2 rounded-full" style={{ background: fg, opacity: 0.4 }} />
        <div className="mt-auto flex gap-0.5">
          <div className="h-1.5 w-2 rounded-sm" style={{ background: accent, opacity: 0.7 }} />
          <div className="h-1.5 w-2 rounded-sm" style={{ background: fg, opacity: 0.3 }} />
          <div className="h-1.5 w-2 rounded-sm" style={{ background: fg, opacity: 0.3 }} />
        </div>
      </div>
    );
  }

  if (id === "spotlight") {
    return (
      <div className="aspect-[4/3] grid grid-cols-2 gap-1 p-1.5" style={{ background: bg }}>
        <div className="flex flex-col gap-0.5">
          <div className="h-1 w-3/4 rounded-full" style={{ background: fg, opacity: 0.8 }} />
          <div className="h-0.5 w-1/2 rounded-full" style={{ background: accent, opacity: 0.9 }} />
          <div className="mt-auto flex flex-col gap-0.5">
            <div className="flex items-center gap-1">
              <div className="h-px w-3" style={{ background: accent }} />
              <div className="h-0.5 w-2 rounded-full" style={{ background: fg, opacity: 0.6 }} />
            </div>
            <div className="flex items-center gap-1">
              <div className="h-px w-1.5" style={{ background: fg, opacity: 0.4 }} />
              <div className="h-0.5 w-2 rounded-full" style={{ background: fg, opacity: 0.4 }} />
            </div>
          </div>
        </div>
        <div className="space-y-0.5">
          <div className="h-0.5 w-full rounded-full" style={{ background: fg, opacity: 0.4 }} />
          <div className="h-0.5 w-3/4 rounded-full" style={{ background: fg, opacity: 0.3 }} />
          <div className="h-0.5 w-2/3 rounded-full" style={{ background: fg, opacity: 0.3 }} />
        </div>
      </div>
    );
  }

  if (id === "glow") {
    return (
      <div
        className="aspect-[4/3] flex flex-col gap-1 p-1.5 relative"
        style={{
          background: bg,
          backgroundImage:
            "radial-gradient(ellipse at top right, rgba(99,102,241,0.32), transparent 60%), radial-gradient(ellipse at bottom left, rgba(14,165,233,0.18), transparent 60%)",
        }}
      >
        <div className="flex items-center gap-1">
          <div
            className="size-1 rounded-full"
            style={{ background: "linear-gradient(135deg, #0ea5e9, #6366f1)" }}
          />
          <div className="h-0.5 w-6 rounded-full" style={{ background: fg, opacity: 0.4 }} />
        </div>
        <div
          className="h-1.5 w-1/2 rounded-full mt-0.5"
          style={{ background: "linear-gradient(135deg, #ffffff, #93c5fd, #6366f1)" }}
        />
        <div className="h-0.5 w-2/3 rounded-full" style={{ background: fg, opacity: 0.4 }} />
        <div className="mt-auto grid grid-cols-2 gap-0.5">
          <div className="h-2.5 rounded-sm" style={{ background: `${fg}1a` }} />
          <div
            className="h-2.5 rounded-sm"
            style={{ background: "linear-gradient(135deg, rgba(14,165,233,0.45), rgba(99,102,241,0.30))" }}
          />
        </div>
      </div>
    );
  }

  if (id === "bento") {
    return (
      <div className="aspect-[4/3] grid grid-cols-3 grid-rows-3 gap-0.5 p-1" style={{ background: bg }}>
        <div
          className="col-span-2 row-span-2 rounded-sm"
          style={{ background: "linear-gradient(135deg, rgba(59,130,246,0.45), rgba(14,165,233,0.20))" }}
        />
        <div className="rounded-sm" style={{ background: `${fg}1a` }} />
        <div className="rounded-sm" style={{ background: `${fg}14` }} />
        <div className="col-span-2 rounded-sm" style={{ background: `${fg}1a` }} />
        <div className="rounded-sm" style={{ background: "rgba(99,102,241,0.45)" }} />
      </div>
    );
  }

  if (id === "terminal") {
    return (
      <div className="aspect-[4/3] flex flex-col gap-0.5 p-1.5 font-mono" style={{ background: bg }}>
        <div className="flex gap-0.5">
          <div className="size-1 rounded-full bg-[#ff5f56]" />
          <div className="size-1 rounded-full bg-[#ffbd2e]" />
          <div className="size-1 rounded-full bg-[#27c93f]" />
        </div>
        <div className="text-[5px] mt-0.5" style={{ color: fg }}>$ whoami</div>
        <div className="text-[5px]" style={{ color: fg, opacity: 0.7 }}>{">"} dev_</div>
        <div className="text-[5px]" style={{ color: fg, opacity: 0.5 }}>--------</div>
      </div>
    );
  }

  // minimal
  return (
    <div className="aspect-[4/3] flex flex-col gap-0.5 p-1.5 font-mono" style={{ background: bg }}>
      <div className="h-0.5 w-1/2 rounded-full" style={{ background: accent, opacity: 0.9 }} />
      <div className="h-0.5 w-2/3 rounded-full" style={{ background: fg, opacity: 0.6 }} />
      <div className="h-0.5 w-1/3 rounded-full" style={{ background: fg, opacity: 0.4 }} />
      <div className="h-0.5 w-2/3 rounded-full" style={{ background: fg, opacity: 0.4 }} />
      <div className="h-0.5 w-1/2 rounded-full" style={{ background: fg, opacity: 0.4 }} />
      <div className="h-0.5 w-2/3 rounded-full" style={{ background: fg, opacity: 0.4 }} />
    </div>
  );
}
