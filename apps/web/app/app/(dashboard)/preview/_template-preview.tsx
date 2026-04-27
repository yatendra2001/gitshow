"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
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
 * Renders the chosen template against the user's draft Resume and
 * shows a single floating "Templates" button bottom-right. Clicking
 * opens a popover with the template tiles. Picking a tile swaps the
 * preview locally and closes the popover. A second pill appears next
 * to the button when there's an unsaved change, with Save and
 * Save+publish actions.
 *
 * The chooser only mutates `theme.template`; switching templates
 * costs zero data loss because every variant renders the same Resume.
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

  // Esc closes the popover
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
    setOpen(false); // close popover so the user sees the full preview
  };

  const onSave = (alsoPublish: boolean) => {
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

        if (alsoPublish) {
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
          return;
        }

        setJustSaved(true);
        setTimeout(() => setJustSaved(false), 2000);
      } catch {
        setError("Network error");
      }
    });
  };

  return (
    <>
      <DataProvider resume={previewResume} handle={handle}>
        <Template />
      </DataProvider>

      <ChooserButton
        savedTemplate={savedTemplate}
        pendingTemplate={pendingTemplate}
        dirty={dirty}
        busy={busy}
        error={error}
        justSaved={justSaved}
        isPublished={isPublished}
        open={open}
        onOpen={setOpen}
        onPick={onPick}
        onSave={onSave}
      />
    </>
  );
}

/* ─────────────────────────  Floating button + popover  ────────────────────────── */

function ChooserButton({
  savedTemplate,
  pendingTemplate,
  dirty,
  busy,
  error,
  justSaved,
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
  error: string | null;
  justSaved: boolean;
  isPublished: boolean;
  open: boolean;
  onOpen: (v: boolean) => void;
  onPick: (id: TemplateId) => void;
  onSave: (alsoPublish: boolean) => void;
}) {
  const popRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const meta = getTemplateMeta(pendingTemplate);

  // Click-outside to dismiss
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
    <div className="fixed bottom-5 right-5 sm:bottom-6 sm:right-6 z-[60] flex flex-col items-end gap-2">
      {/* Save pill — only appears when there's a pending change */}
      <AnimatePresence>
        {(dirty || error || justSaved) && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.96 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="rounded-full bg-background/90 backdrop-blur-xl border border-border/60 shadow-[0_20px_40px_-15px_rgba(0,0,0,0.4)] px-1.5 py-1 flex items-center gap-1"
          >
            {error ? (
              <span className="px-2 text-[12px] text-[var(--destructive)]">{error}</span>
            ) : justSaved ? (
              <span className="px-2 text-[12px] text-emerald-500 inline-flex items-center gap-1">
                <Check className="size-3" /> Saved
              </span>
            ) : null}
            {dirty && !justSaved && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onSave(false)}
                  className="inline-flex h-7 items-center rounded-full px-3 text-[12px] font-medium text-muted-foreground hover:text-foreground hover:bg-card/60 transition-colors disabled:opacity-60"
                >
                  Save draft
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onSave(true)}
                  className="inline-flex h-7 items-center gap-1.5 rounded-full bg-foreground px-3 text-[12px] font-medium text-background hover:opacity-90 disabled:opacity-60"
                >
                  {busy ? (
                    <>
                      <Loader2 className="size-3 animate-spin" />
                      {isPublished ? "Republishing" : "Publishing"}
                    </>
                  ) : isPublished ? (
                    "Save & republish"
                  ) : (
                    "Save & publish"
                  )}
                </button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Popover */}
      <AnimatePresence>
        {open && (
          <motion.div
            ref={popRef}
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="w-[min(92vw,540px)] rounded-2xl bg-background/95 backdrop-blur-xl border border-border/60 shadow-[0_30px_60px_-15px_rgba(0,0,0,0.5)] overflow-hidden"
            role="dialog"
            aria-label="Pick a template"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
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
                className="size-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-card/60 transition-colors"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="p-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
              {TEMPLATES.map((t) => {
                const active = t.id === pendingTemplate;
                const saved = t.id === savedTemplate;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onPick(t.id)}
                    title={t.tagline}
                    className={`group relative flex flex-col items-stretch rounded-xl overflow-hidden border transition-all text-left ${
                      active
                        ? "border-foreground/80 ring-2 ring-foreground/15"
                        : "border-border/40 hover:border-border hover:shadow-sm"
                    }`}
                  >
                    <TemplateSwatch id={t.id} />
                    <div className="px-2.5 py-1.5 bg-card/30 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[12.5px] font-semibold leading-tight truncate">
                          {t.name}
                        </div>
                        <div className="text-[10.5px] text-muted-foreground leading-tight truncate">
                          {t.vibes[0]}
                        </div>
                      </div>
                      {saved && (
                        <span
                          className={`size-4 rounded-full flex-none flex items-center justify-center ${
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

            <div className="px-4 py-3 border-t border-border/40 flex items-center justify-between gap-3">
              <div className="text-[11.5px] text-muted-foreground min-w-0">
                <span className="text-foreground/80 font-medium">{meta.name}</span>
                <span className="hidden sm:inline"> · {meta.bestFor}</span>
              </div>
              {dirty ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onSave(true)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md bg-foreground px-3 text-[12.5px] font-medium text-background hover:opacity-90 disabled:opacity-60 flex-none"
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
                <span className="text-[11.5px] text-muted-foreground inline-flex items-center gap-1 flex-none">
                  <Check className="size-3 text-emerald-500" />
                  Saved
                </span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Trigger button */}
      <button
        ref={btnRef}
        type="button"
        onClick={() => onOpen(!open)}
        aria-expanded={open}
        aria-label="Pick a template"
        className="group inline-flex items-center gap-2 rounded-full bg-foreground text-background px-4 h-11 shadow-[0_20px_40px_-15px_rgba(0,0,0,0.45)] hover:scale-[1.02] active:scale-[0.98] transition-transform"
      >
        <Sparkles className="size-4 opacity-90" />
        <span className="text-[13px] font-medium">Templates</span>
        <span className="text-[11.5px] opacity-70 hidden sm:inline">· {meta.name}</span>
        <ChevronDown
          className={`size-3.5 opacity-70 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
    </div>
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
          background: `${bg}`,
          backgroundImage: `radial-gradient(ellipse at top, ${accent}33, transparent 60%)`,
        }}
      >
        <div className="flex items-center gap-1">
          <div className="size-1 rounded-full" style={{ background: accent }} />
          <div className="h-0.5 w-6 rounded-full" style={{ background: fg, opacity: 0.4 }} />
        </div>
        <div
          className="h-1.5 w-1/2 rounded-full mt-0.5"
          style={{ background: `linear-gradient(135deg, ${fg}, ${accent})` }}
        />
        <div className="h-0.5 w-2/3 rounded-full" style={{ background: fg, opacity: 0.4 }} />
        <div className="mt-auto grid grid-cols-2 gap-0.5">
          <div className="h-2.5 rounded-sm" style={{ background: `${fg}1a` }} />
          <div
            className="h-2.5 rounded-sm"
            style={{ background: `linear-gradient(135deg, ${accent}40, ${fg}1a)` }}
          />
        </div>
      </div>
    );
  }

  if (id === "bento") {
    return (
      <div className="aspect-[4/3] grid grid-cols-3 grid-rows-3 gap-0.5 p-1" style={{ background: bg }}>
        <div className="col-span-2 row-span-2 rounded-sm" style={{ background: `${accent}3a` }} />
        <div className="rounded-sm" style={{ background: `${fg}1a` }} />
        <div className="rounded-sm" style={{ background: `${fg}14` }} />
        <div className="col-span-2 rounded-sm" style={{ background: `${fg}1a` }} />
        <div className="rounded-sm" style={{ background: `${accent}40` }} />
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
