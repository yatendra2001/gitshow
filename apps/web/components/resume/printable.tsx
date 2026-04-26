/**
 * Printable resume — React wrapper around the pure HTML renderer.
 *
 * The actual markup lives in `printable-html.ts` so the PDF route can
 * reuse the same string output without bringing in `react-dom/server`
 * (which Turbopack disallows in Next 16 route-graph modules).
 *
 * For the editor preview we just inject the HTML via
 * `dangerouslySetInnerHTML` — the input is server-rendered from a
 * validated `ResumeDoc`, and the renderer escapes every user-supplied
 * field, so this is safe.
 */

import type { ResumeDoc } from "@gitshow/shared/resume-doc";
import { renderResumeHtml, RESUME_PRINT_CSS } from "./printable-html";

export { RESUME_PRINT_CSS };

export interface PrintableResumeProps {
  doc: ResumeDoc;
  /** Render with explicit page-frame styling. False = used inside the editor preview. */
  fullPage?: boolean;
}

export function PrintableResume({ doc, fullPage = false }: PrintableResumeProps) {
  const html = renderResumeHtml(doc, { fullPage });
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
