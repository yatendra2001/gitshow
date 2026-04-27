"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, Loader2, Sparkles } from "lucide-react";
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
 * floats a horizontal template chooser strip at the bottom. Picking
 * a template swaps the preview locally; "Use this" persists the
 * choice via PATCH /api/resume/draft and republishes if the portfolio
 * is already live.
 *
 * The chooser only mutates `theme.template`; it never touches any
 * other draft field. Switching templates therefore costs zero data
 * loss — every variant renders the same Resume.
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
  // The local resume state is what the preview renders against. It
  // tracks the saved draft EXCEPT for `theme.template`, which the user
  // can swap at will to compare looks before committing.
  const [resume, setResume] = useState<Resume>(initialResume);
  const [pendingTemplate, setPendingTemplate] = useState<TemplateId>(
    initialResume.theme.template,
  );
  const [savedTemplate, setSavedTemplate] = useState<TemplateId>(
    initialResume.theme.template,
  );
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

  const onPick = (id: TemplateId) => {
    setPendingTemplate(id);
    setError(null);
    setJustSaved(false);
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
          // Hard reload so the live page picks up the new published.json
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
      {/* The actual portfolio render — full-bleed under the chooser. */}
      <DataProvider resume={previewResume} handle={handle}>
        <div className="pb-32">
          <Template />
        </div>
      </DataProvider>

      {/* Floating chooser dock */}
      <TemplateChooserDock
        savedTemplate={savedTemplate}
        pendingTemplate={pendingTemplate}
        dirty={dirty}
        busy={busy}
        error={error}
        justSaved={justSaved}
        isPublished={isPublished}
        onPick={onPick}
        onSave={onSave}
      />
    </>
  );
}

function TemplateChooserDock({
  savedTemplate,
  pendingTemplate,
  dirty,
  busy,
  error,
  justSaved,
  isPublished,
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
  onPick: (id: TemplateId) => void;
  onSave: (alsoPublish: boolean) => void;
}) {
  const meta = getTemplateMeta(pendingTemplate);

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 pointer-events-none">
      <div className="mx-auto max-w-5xl px-3 sm:px-6 pb-3 sm:pb-5">
        <div className="pointer-events-auto rounded-2xl border border-border/60 bg-background/85 backdrop-blur-xl shadow-[0_20px_50px_-15px_rgba(0,0,0,0.45)] overflow-hidden">
          {/* Top row: tiles + actions */}
          <div className="flex items-stretch gap-1 p-2 overflow-x-auto">
            <div className="hidden sm:flex items-center px-3 text-[11px] uppercase tracking-[0.2em] text-muted-foreground font-semibold flex-none">
              <Sparkles className="size-3.5 mr-1.5 text-foreground/70" />
              Template
            </div>
            <div className="flex items-stretch gap-1 flex-1 min-w-0">
              {TEMPLATES.map((t) => {
                const active = t.id === pendingTemplate;
                const saved = t.id === savedTemplate;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onPick(t.id)}
                    title={t.tagline}
                    className={`relative flex-1 min-w-[88px] flex flex-col items-stretch rounded-xl overflow-hidden border transition-all ${
                      active
                        ? "border-foreground/80 ring-2 ring-foreground/20"
                        : "border-border/40 hover:border-border"
                    }`}
                  >
                    <TemplateSwatch id={t.id} />
                    <div className="px-2 py-1.5 bg-background/60 text-left">
                      <div className="text-[12px] font-semibold leading-tight truncate">
                        {t.name}
                      </div>
                      <div className="text-[10px] text-muted-foreground leading-tight truncate">
                        {t.vibes[0]}
                      </div>
                    </div>
                    {saved && !active && (
                      <span className="absolute top-1 right-1 size-4 rounded-full bg-foreground text-background flex items-center justify-center" title="Currently saved">
                        <Check className="size-2.5" strokeWidth={3} />
                      </span>
                    )}
                    {active && saved && (
                      <span className="absolute top-1 right-1 size-4 rounded-full bg-emerald-500 text-white flex items-center justify-center" title="Active and saved">
                        <Check className="size-2.5" strokeWidth={3} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Bottom row: meta + actions */}
          <div className="flex flex-wrap items-center gap-3 border-t border-border/40 px-3 sm:px-4 py-2.5 bg-card/30">
            <div className="flex-1 min-w-0">
              <div className="text-[12.5px] font-medium leading-tight truncate">
                {meta.name} <span className="text-muted-foreground font-normal">— {meta.tagline}</span>
              </div>
              <div className="text-[11px] text-muted-foreground leading-tight truncate">
                {meta.bestFor}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-none">
              {error && (
                <span className="text-[11px] text-[var(--destructive)]">{error}</span>
              )}
              {justSaved && !error && (
                <span className="text-[11px] text-emerald-500 inline-flex items-center gap-1">
                  <Check className="size-3" /> Saved
                </span>
              )}
              {dirty && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onSave(false)}
                  className="inline-flex h-8 items-center rounded-md border border-border/60 bg-background px-3 text-[12px] font-medium hover:bg-card/60 disabled:opacity-60"
                >
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : "Save as default"}
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => onSave(true)}
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-foreground px-3 text-[12px] font-medium text-background hover:opacity-90 disabled:opacity-60"
              >
                {busy ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    {isPublished ? "Republishing…" : "Publishing…"}
                  </>
                ) : dirty ? (
                  isPublished ? "Save & republish" : "Save & publish"
                ) : isPublished ? (
                  "Republish"
                ) : (
                  "Publish"
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Tiny visual hint of what each template feels like. Drawn entirely
 * with CSS — keeps the bundle small and the dock instant. Not a
 * pixel-perfect mock; just enough that you know which is which.
 */
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

  if (id === "magazine") {
    return (
      <div className="aspect-[4/3] flex flex-col gap-1 p-1.5" style={{ background: bg }}>
        <div className="text-[4px] uppercase tracking-widest font-bold" style={{ color: accent }}>The Quarterly</div>
        <div className="font-serif text-[10px] leading-none" style={{ color: fg }}>Title.</div>
        <div className="grid grid-cols-2 gap-0.5 mt-auto">
          <div className="h-0.5 rounded-full" style={{ background: fg, opacity: 0.5 }} />
          <div className="h-0.5 rounded-full" style={{ background: fg, opacity: 0.5 }} />
          <div className="h-0.5 rounded-full" style={{ background: fg, opacity: 0.3 }} />
          <div className="h-0.5 rounded-full" style={{ background: fg, opacity: 0.3 }} />
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

  if (id === "brutalist") {
    return (
      <div className="aspect-[4/3] flex flex-col gap-0.5 p-1" style={{ background: bg }}>
        <div className="font-bold text-[7px] leading-[0.85] uppercase" style={{ color: fg }}>NAME.</div>
        <div className="font-bold text-[7px] leading-[0.85] uppercase" style={{ color: accent }}>BIG.</div>
        <div className="mt-auto h-0.5" style={{ background: fg }} />
        <div className="grid grid-cols-2 gap-0.5">
          <div className="h-2 border" style={{ borderColor: fg }} />
          <div className="h-2 border" style={{ borderColor: fg, background: accent }} />
        </div>
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
