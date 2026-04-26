/**
 * Printable resume — pure HTML-string renderer.
 *
 * Single source of truth for resume markup. Used by:
 *   1. The React preview component (`PrintableResume`) — wraps this
 *      output in `dangerouslySetInnerHTML`.
 *   2. The /api/resume/doc/pdf route — feeds the string straight to
 *      Cloudflare Browser Rendering's `page.setContent()`.
 *
 * Why string-based instead of JSX → renderToStaticMarkup? Next.js 16 +
 * Turbopack disallow `react-dom/server` imports inside route-graph
 * modules. A pure string template sidesteps that entirely and means
 * the PDF route has zero React-server dependency.
 *
 * Hard rules baked in here:
 *   - Pure black-and-white. No accent colors. ATS parsers + recruiter
 *     printers love this.
 *   - System sans-serif stack. Standard fonts pass every parser.
 *   - Single column, single page (Letter or A4 driven by `page.size`).
 *   - All sizes in pt — pt is the canonical PDF print unit, so the
 *     editor preview and the PDF agree pixel-for-pixel.
 *   - No images, no avatar, no SVG icons.
 */

import type { ResumeDoc } from "@gitshow/shared/resume-doc";
import { visibleResumeSections } from "@gitshow/shared/resume-doc";

const PAGE_DIMENSIONS = {
  letter: { width: "8.5in", height: "11in" },
  a4: { width: "210mm", height: "297mm" },
} as const;

/**
 * Render a full resume to HTML. Output is the inner article — wrap with
 * `<html><body>...</body></html>` (and the print CSS) at the call site
 * if you need a complete document.
 */
export function renderResumeHtml(
  doc: ResumeDoc,
  opts: { fullPage?: boolean } = {},
): string {
  const dim = PAGE_DIMENSIONS[doc.page.size];
  const visible = visibleResumeSections(doc);

  const inlineStyle = opts.fullPage
    ? `width:${dim.width};min-height:${dim.height};`
    : `width:${dim.width};min-height:${dim.height};box-shadow:0 1px 2px rgba(0,0,0,0.04),0 8px 32px rgba(0,0,0,0.08);background:#ffffff;`;

  const sections = visible
    .map((key) => renderSection(key, doc))
    .filter((s) => s.length > 0)
    .join("");

  return `<article class="resume-doc" data-page-size="${esc(doc.page.size)}" style="${inlineStyle}">${renderHeader(doc)}${sections}</article>`;
}

function renderSection(key: string, doc: ResumeDoc): string {
  switch (key) {
    case "experience":
      return doc.experience.length ? renderExperience(doc) : "";
    case "projects":
      return doc.projects.length ? renderProjects(doc) : "";
    case "education":
      return doc.education.length ? renderEducation(doc) : "";
    case "skills":
      return doc.skills.length ? renderSkills(doc) : "";
    case "awards":
      return doc.awards.length ? renderAwards(doc) : "";
    case "publications":
      return doc.publications.length ? renderPublications(doc) : "";
    default:
      return "";
  }
}

function renderHeader(doc: ResumeDoc): string {
  const { header } = doc;
  const contactBits = [header.location, header.email, header.phone]
    .filter((s): s is string => Boolean(s && s.trim()))
    .map((s) => esc(s));
  const linkBits = header.links
    .filter((l) => l.label?.trim() && l.url?.trim())
    .map(
      (link) => `<a href="${esc(link.url)}">${esc(link.label)}</a>`,
    );

  const headline = header.headline
    ? `<p class="resume-headline">${esc(header.headline)}</p>`
    : "";

  const contactLine = contactBits.length || linkBits.length
    ? `<p class="resume-contact">${joinWithSep([...contactBits, ...linkBits])}</p>`
    : "";

  return `<header class="resume-header"><h1 class="resume-name">${esc(header.name || "Your Name")}</h1>${headline}${contactLine}</header>`;
}

function renderExperience(doc: ResumeDoc): string {
  const entries = doc.experience
    .map((entry) => {
      const dates = `${esc(entry.start)}${entry.end ? ` – ${esc(entry.end)}` : ""}`;
      const location = entry.location
        ? `<span class="resume-entry-meta">${esc(entry.location)}</span>`
        : "";
      const bullets = entry.bullets.length
        ? `<ul class="resume-bullets">${entry.bullets.map((b) => `<li>${renderBulletWithEmphasis(b)}</li>`).join("")}</ul>`
        : "";
      return `<div class="resume-entry"><div class="resume-entry-row"><span class="resume-entry-strong">${esc(entry.company)}</span><span class="resume-entry-meta">${dates}</span></div><div class="resume-entry-row"><span class="resume-entry-italic">${esc(entry.title)}</span>${location}</div>${bullets}</div>`;
    })
    .join("");
  return `<section class="resume-section"><h2 class="resume-section-title">Experience</h2>${entries}</section>`;
}

function renderProjects(doc: ResumeDoc): string {
  const entries = doc.projects
    .map((entry) => {
      const titleAndUrl = entry.url
        ? `${esc(entry.title)} — <a href="${esc(entry.url)}" class="resume-link">${esc(prettyUrl(entry.url))}</a>`
        : esc(entry.title);
      const dates = entry.dates
        ? `<span class="resume-entry-meta">${esc(entry.dates)}</span>`
        : "";
      const stack = entry.stack
        ? `<div class="resume-entry-row"><span class="resume-entry-italic">${esc(entry.stack)}</span></div>`
        : "";
      const bullets = entry.bullets.length
        ? `<ul class="resume-bullets">${entry.bullets.map((b) => `<li>${renderBulletWithEmphasis(b)}</li>`).join("")}</ul>`
        : "";
      return `<div class="resume-entry"><div class="resume-entry-row"><span class="resume-entry-strong">${titleAndUrl}</span>${dates}</div>${stack}${bullets}</div>`;
    })
    .join("");
  return `<section class="resume-section"><h2 class="resume-section-title">Projects</h2>${entries}</section>`;
}

function renderEducation(doc: ResumeDoc): string {
  const entries = doc.education
    .map((entry) => {
      const dates = `${esc(entry.start)}${entry.end ? ` – ${esc(entry.end)}` : ""}`;
      const location = entry.location
        ? `<span class="resume-entry-meta">${esc(entry.location)}</span>`
        : "";
      const detail = entry.detail
        ? `<p class="resume-entry-note">${esc(entry.detail)}</p>`
        : "";
      return `<div class="resume-entry"><div class="resume-entry-row"><span class="resume-entry-strong">${esc(entry.school)}</span><span class="resume-entry-meta">${dates}</span></div><div class="resume-entry-row"><span class="resume-entry-italic">${esc(entry.degree)}</span>${location}</div>${detail}</div>`;
    })
    .join("");
  return `<section class="resume-section"><h2 class="resume-section-title">Education</h2>${entries}</section>`;
}

function renderSkills(doc: ResumeDoc): string {
  const rows = doc.skills
    .map(
      (g) =>
        `<tr><td class="resume-skill-label">${esc(g.label)}</td><td class="resume-skill-items">${esc(g.items)}</td></tr>`,
    )
    .join("");
  return `<section class="resume-section"><h2 class="resume-section-title">Skills</h2><table class="resume-skills"><tbody>${rows}</tbody></table></section>`;
}

function renderAwards(doc: ResumeDoc): string {
  const entries = doc.awards
    .map((entry) => {
      const date = entry.date
        ? `<span class="resume-entry-meta">${esc(entry.date)}</span>`
        : "";
      const detail = entry.detail
        ? `<p class="resume-entry-note">${esc(entry.detail)}</p>`
        : "";
      return `<div class="resume-award"><div class="resume-entry-row"><span class="resume-entry-strong">${esc(entry.title)}</span>${date}</div>${detail}</div>`;
    })
    .join("");
  return `<section class="resume-section"><h2 class="resume-section-title">Awards &amp; Honors</h2>${entries}</section>`;
}

function renderPublications(doc: ResumeDoc): string {
  const items = doc.publications
    .map((p) => {
      const inner = p.url
        ? `<a href="${esc(p.url)}">${esc(p.citation)}</a>`
        : esc(p.citation);
      return `<li>${inner}</li>`;
    })
    .join("");
  return `<section class="resume-section"><h2 class="resume-section-title">Publications</h2><ol class="resume-pubs">${items}</ol></section>`;
}

/**
 * Bullet text supports `**bold**` to emphasize impact metrics. The AI
 * is instructed to wrap key numbers/scale/percentages in `**...**`,
 * the editor textarea round-trips the raw markdown, and this renderer
 * turns each pair into <strong>. Anything that isn't a complete pair
 * is left as plain text — robust to half-typed input.
 *
 * Escaping happens here too: the input is user-controlled, so we
 * escape before splitting on the (already-escaped) `**` markers.
 */
function renderBulletWithEmphasis(text: string): string {
  const escaped = esc(text);
  return escaped.replace(
    /\*\*([^*\n]+?)\*\*/g,
    (_, inner) => `<strong class="resume-emph">${inner}</strong>`,
  );
}

function joinWithSep(parts: string[]): string {
  return parts
    .map((p, i) =>
      i === 0 ? p : `<span class="resume-sep" aria-hidden> · </span>${p}`,
    )
    .join("");
}

function prettyUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname.replace(/\/$/, "")}`;
  } catch {
    return url;
  }
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The single source of truth for resume typography. Used in two
 * places: the editor preview <style> tag, and the PDF route's HTML
 * wrapper. Keep them on this one constant so they never drift.
 *
 * Sizes are pt-based to match how PDF renders treat the page. The
 * editor preview reads them as CSS pt and they look identical because
 * the page is rendered at 96dpi with 1:1 scaling before transform.
 */
export const RESUME_PRINT_CSS = `
  /* The resume is a forced-light island. The dashboard ships its own
     dark-mode foreground/background variables which cascade into this
     component via inheritance — without these overrides the resume
     turned into near-white text on a light card in dark mode (the
     classic invisible-resume bug). 'color-scheme: light' resets the
     UA color scheme inside the resume; the explicit color/background
     pair beats any ancestor that set them via custom properties. */
  .resume-doc {
    color: #000 !important;
    background: #fff !important;
    color-scheme: light;
    font-family: "Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif;
    font-size: 10.5pt;
    line-height: 1.4;
    padding: 0.6in 0.7in;
    box-sizing: border-box;
    flex-shrink: 0;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .resume-doc * { box-sizing: border-box; color: inherit; }
  .resume-doc a { color: inherit !important; text-decoration: none; }

  .resume-header { margin-bottom: 14pt; text-align: center; }
  .resume-name {
    font-size: 20pt;
    font-weight: 700;
    letter-spacing: 0.5pt;
    margin: 0 0 2pt 0;
    text-transform: uppercase;
  }
  .resume-headline {
    font-size: 10.5pt;
    font-weight: 400;
    margin: 0 0 4pt 0;
    color: #000;
  }
  .resume-contact {
    font-size: 9.5pt;
    margin: 0;
    color: #000;
  }
  .resume-sep { color: #000; }

  .resume-section { margin-bottom: 10pt; }
  .resume-section-title {
    font-size: 10pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6pt;
    margin: 0 0 4pt 0;
    padding-bottom: 2pt;
    border-bottom: 0.5pt solid #000;
  }

  .resume-entry { margin-bottom: 6pt; }
  .resume-entry:last-child { margin-bottom: 0; }
  .resume-entry-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12pt;
  }
  .resume-entry-strong { font-weight: 700; }
  .resume-entry-italic { font-style: italic; }
  .resume-entry-meta {
    white-space: nowrap;
    font-feature-settings: "tnum";
    font-variant-numeric: tabular-nums;
  }
  .resume-entry-note { margin: 2pt 0 0; }

  .resume-bullets {
    list-style: disc;
    margin: 3pt 0 0;
    padding-left: 14pt;
  }
  .resume-bullets li {
    margin-bottom: 1pt;
    page-break-inside: avoid;
  }
  .resume-emph {
    font-weight: 700;
  }

  .resume-skills {
    width: 100%;
    border-collapse: collapse;
  }
  .resume-skills td {
    padding: 1pt 0;
    vertical-align: baseline;
  }
  .resume-skill-label {
    font-weight: 700;
    width: 80pt;
    padding-right: 8pt;
    white-space: nowrap;
  }

  .resume-award { margin-bottom: 4pt; }

  .resume-pubs {
    margin: 0;
    padding-left: 14pt;
  }
  .resume-pubs li { margin-bottom: 3pt; }

  @media print {
    @page { size: letter; margin: 0; }
    html, body { margin: 0; padding: 0; background: #fff; }
    .resume-doc { box-shadow: none !important; }
  }
`;
