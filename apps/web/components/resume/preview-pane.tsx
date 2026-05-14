"use client";

/**
 * Shared resume preview — a scaled `<PrintableResume>` with optional
 * page-fit measurement and an automatic "Page 2 starts" overflow
 * marker. Used by:
 *
 *   - The base editor's right-hand preview pane (`/app/resume`).
 *   - The tailored detail page preview (`/app/resume/tailored/[id]`).
 *
 * Caller controls the outer container — the editor wants a full-bleed
 * scrolling pane, the detail page wants a rounded card. Inside that
 * container this component owns: stylesheet injection, the scale
 * transform, ResizeObserver-driven fit measurement, and the red
 * "Page 2 starts" overlay when the rendered doc overflows.
 *
 * Behaviour ported verbatim from `_resume-editor.tsx`'s original
 * `PreviewPane` — same RAF + ResizeObserver + fonts.ready listener
 * stack — so measurements are byte-identical regardless of host.
 */

import { useEffect, useRef, useState } from "react";
import type { ResumeDoc } from "@gitshow/shared/resume-doc";
import { PrintableResume, RESUME_PRINT_CSS } from "./printable";

export type ResumePageFit = {
  pages: number;
  pageHeightPx: number;
  scrollHeight: number;
  overflowPx: number;
};

export interface ResumePreviewProps {
  doc: ResumeDoc;
  /**
   * Transform scale. Pass a number (e.g. `0.72`) or a CSS variable
   * expression (e.g. `"var(--resume-scale, 0.78)"`) — both are passed
   * directly into the `transform: scale(...)` declaration.
   */
  scale?: number | string;
  /** Fires whenever measurement settles. */
  onFitChange?: (fit: ResumePageFit) => void;
  /**
   * Inject `RESUME_PRINT_CSS` here. Default true. Disable when a
   * parent surface has already mounted the stylesheet (e.g. the
   * streaming view mounts print + shimmer in one combined block).
   */
  injectCss?: boolean;
}

export function ResumePreview({
  doc,
  scale = "var(--resume-scale, 0.78)",
  onFitChange,
  injectCss = true,
}: ResumePreviewProps) {
  const previewRef = useRef<HTMLDivElement | null>(null);
  const [localFit, setLocalFit] = useState<ResumePageFit | null>(null);

  useEffect(() => {
    let cancelled = false;
    let raf = 0;

    const measure = () => {
      if (raf) window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(() => {
        const article = previewRef.current?.querySelector(".resume-doc");
        if (!(article instanceof HTMLElement) || cancelled) return;

        const pageHeightPx = pageHeightForSize(doc.page.size);
        const scrollHeight = article.scrollHeight;
        const fit: ResumePageFit = {
          pages: Math.max(1, Math.ceil(scrollHeight / pageHeightPx)),
          pageHeightPx,
          scrollHeight,
          overflowPx: scrollHeight - pageHeightPx,
        };

        setLocalFit(fit);
        onFitChange?.(fit);
      });
    };

    measure();

    const article = previewRef.current?.querySelector(".resume-doc");
    const observer = new ResizeObserver(measure);
    if (article instanceof HTMLElement) observer.observe(article);
    if (previewRef.current) observer.observe(previewRef.current);

    window.addEventListener("resize", measure);
    void document.fonts?.ready.then(measure).catch(() => {});

    return () => {
      cancelled = true;
      if (raf) window.cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [doc, onFitChange]);

  const scaleExpr = typeof scale === "number" ? String(scale) : scale;

  return (
    <>
      {/* Plain <style> tag with dangerouslySetInnerHTML — styled-jsx
          silently drops `<style jsx global>{`${dynamicString}`}` when
          the template literal contains only an interpolation, which
          was eating every resume rule and making the preview render
          as plain text. */}
      {injectCss ? (
        <style dangerouslySetInnerHTML={{ __html: RESUME_PRINT_CSS }} />
      ) : null}
      <div className="flex justify-center px-6 py-8">
        <div
          className="origin-top"
          style={{
            transform: `scale(${scaleExpr})`,
            transformOrigin: "top center",
          }}
        >
          <div ref={previewRef} className="relative">
            <PrintableResume doc={doc} />
            {localFit && localFit.pages > 1 ? (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 z-20 flex items-center gap-2"
                style={{ top: localFit.pageHeightPx }}
              >
                <span className="h-px flex-1 bg-red-500/70" />
                <span className="rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-white shadow-sm">
                  Page 2 starts
                </span>
                <span className="h-px flex-1 bg-red-500/70" />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}

export function pageHeightForSize(size: ResumeDoc["page"]["size"]): number {
  return size === "a4" ? (297 / 25.4) * 96 : 11 * 96;
}
