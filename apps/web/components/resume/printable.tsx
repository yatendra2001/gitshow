/**
 * Printable resume — the actual document layout.
 *
 * One JSX tree powers two surfaces:
 *   1. Live preview in the editor (rendered as a scaled "page" in the
 *      right pane).
 *   2. Server-rendered HTML for /api/resume/doc/pdf, fed to Cloudflare
 *      Browser Rendering's `page.setContent()` for headless print.
 *
 * Hard rules baked in here:
 *   - Pure black-and-white. No accent colors. ATS scanners + recruiter
 *     printers love this.
 *   - System sans-serif stack (Helvetica/Arial-equivalent). Standard
 *     fonts pass every ATS parser without fail.
 *   - Single column, single page (Letter or A4 driven by `page.size`).
 *   - All sizes in pt — the PDF renderer treats pt as the canonical
 *     print unit, so the preview and the PDF agree to the pixel.
 *   - No images, no avatar, no SVG icons (the bullet '•' is a glyph).
 *
 * The hosting screen-side container scales this with `transform: scale()`
 * for the editor preview; the print/PDF surface renders at 1:1.
 */

import type {
  ResumeDoc,
  ResumeSectionKey,
} from "@gitshow/shared/resume-doc";
import { visibleResumeSections } from "@gitshow/shared/resume-doc";

const PAGE_DIMENSIONS = {
  letter: { width: "8.5in", height: "11in" },
  a4: { width: "210mm", height: "297mm" },
} as const;

export interface PrintableResumeProps {
  doc: ResumeDoc;
  /** Render with explicit page-frame styling. False = used inside the editor preview. */
  fullPage?: boolean;
}

export function PrintableResume({ doc, fullPage = false }: PrintableResumeProps) {
  const dim = PAGE_DIMENSIONS[doc.page.size];
  const visible = visibleResumeSections(doc);

  return (
    <article
      className="resume-doc"
      data-page-size={doc.page.size}
      style={{
        width: dim.width,
        minHeight: dim.height,
        ...(fullPage
          ? {}
          : {
              boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 8px 32px rgba(0,0,0,0.08)",
              backgroundColor: "#ffffff",
            }),
      }}
    >
      <Header doc={doc} />
      {visible.map((key) => (
        <SectionRouter key={key} sectionKey={key} doc={doc} />
      ))}
    </article>
  );
}

function SectionRouter({
  sectionKey,
  doc,
}: {
  sectionKey: ResumeSectionKey;
  doc: ResumeDoc;
}) {
  switch (sectionKey) {
    case "experience":
      return doc.experience.length ? <ExperienceSection doc={doc} /> : null;
    case "projects":
      return doc.projects.length ? <ProjectsSection doc={doc} /> : null;
    case "education":
      return doc.education.length ? <EducationSection doc={doc} /> : null;
    case "skills":
      return doc.skills.length ? <SkillsSection doc={doc} /> : null;
    case "awards":
      return doc.awards.length ? <AwardsSection doc={doc} /> : null;
    case "publications":
      return doc.publications.length ? <PublicationsSection doc={doc} /> : null;
  }
}

function Header({ doc }: { doc: ResumeDoc }) {
  const { header } = doc;
  const contactBits = [
    header.location,
    header.email,
    header.phone,
  ].filter((s): s is string => Boolean(s && s.trim()));
  const linkBits = header.links.filter((l) => l.label?.trim() && l.url?.trim());

  return (
    <header className="resume-header">
      <h1 className="resume-name">{header.name || "Your Name"}</h1>
      {header.headline ? (
        <p className="resume-headline">{header.headline}</p>
      ) : null}
      {contactBits.length || linkBits.length ? (
        <p className="resume-contact">
          {contactBits.map((bit, i) => (
            <span key={`c-${i}`}>
              {i > 0 ? <Sep /> : null}
              {bit}
            </span>
          ))}
          {linkBits.map((link, i) => (
            <span key={`l-${i}`}>
              {(contactBits.length || i > 0) ? <Sep /> : null}
              <a href={link.url}>{link.label}</a>
            </span>
          ))}
        </p>
      ) : null}
    </header>
  );
}

function Sep() {
  return <span className="resume-sep" aria-hidden> · </span>;
}

function SectionTitle({ children }: { children: string }) {
  return <h2 className="resume-section-title">{children}</h2>;
}

function ExperienceSection({ doc }: { doc: ResumeDoc }) {
  return (
    <section className="resume-section">
      <SectionTitle>Experience</SectionTitle>
      {doc.experience.map((entry) => (
        <div key={entry.id} className="resume-entry">
          <div className="resume-entry-row">
            <span className="resume-entry-strong">{entry.company}</span>
            <span className="resume-entry-meta">
              {entry.start}
              {entry.end ? ` – ${entry.end}` : ""}
            </span>
          </div>
          <div className="resume-entry-row">
            <span className="resume-entry-italic">{entry.title}</span>
            {entry.location ? (
              <span className="resume-entry-meta">{entry.location}</span>
            ) : null}
          </div>
          {entry.bullets.length ? (
            <ul className="resume-bullets">
              {entry.bullets.map((b, i) => (
                <li key={i}>{renderBulletWithEmphasis(b)}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
    </section>
  );
}

function ProjectsSection({ doc }: { doc: ResumeDoc }) {
  return (
    <section className="resume-section">
      <SectionTitle>Projects</SectionTitle>
      {doc.projects.map((entry) => (
        <div key={entry.id} className="resume-entry">
          <div className="resume-entry-row">
            <span className="resume-entry-strong">
              {entry.title}
              {entry.url ? (
                <>
                  {" — "}
                  <a href={entry.url} className="resume-link">
                    {prettyUrl(entry.url)}
                  </a>
                </>
              ) : null}
            </span>
            {entry.dates ? (
              <span className="resume-entry-meta">{entry.dates}</span>
            ) : null}
          </div>
          {entry.stack ? (
            <div className="resume-entry-row">
              <span className="resume-entry-italic">{entry.stack}</span>
            </div>
          ) : null}
          {entry.bullets.length ? (
            <ul className="resume-bullets">
              {entry.bullets.map((b, i) => (
                <li key={i}>{renderBulletWithEmphasis(b)}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
    </section>
  );
}

function EducationSection({ doc }: { doc: ResumeDoc }) {
  return (
    <section className="resume-section">
      <SectionTitle>Education</SectionTitle>
      {doc.education.map((entry) => (
        <div key={entry.id} className="resume-entry">
          <div className="resume-entry-row">
            <span className="resume-entry-strong">{entry.school}</span>
            <span className="resume-entry-meta">
              {entry.start}
              {entry.end ? ` – ${entry.end}` : ""}
            </span>
          </div>
          <div className="resume-entry-row">
            <span className="resume-entry-italic">{entry.degree}</span>
            {entry.location ? (
              <span className="resume-entry-meta">{entry.location}</span>
            ) : null}
          </div>
          {entry.detail ? (
            <p className="resume-entry-note">{entry.detail}</p>
          ) : null}
        </div>
      ))}
    </section>
  );
}

function SkillsSection({ doc }: { doc: ResumeDoc }) {
  return (
    <section className="resume-section">
      <SectionTitle>Skills</SectionTitle>
      <table className="resume-skills">
        <tbody>
          {doc.skills.map((g) => (
            <tr key={g.id}>
              <td className="resume-skill-label">{g.label}</td>
              <td className="resume-skill-items">{g.items}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function AwardsSection({ doc }: { doc: ResumeDoc }) {
  return (
    <section className="resume-section">
      <SectionTitle>Awards & Honors</SectionTitle>
      {doc.awards.map((entry) => (
        <div key={entry.id} className="resume-award">
          <div className="resume-entry-row">
            <span className="resume-entry-strong">{entry.title}</span>
            {entry.date ? (
              <span className="resume-entry-meta">{entry.date}</span>
            ) : null}
          </div>
          {entry.detail ? (
            <p className="resume-entry-note">{entry.detail}</p>
          ) : null}
        </div>
      ))}
    </section>
  );
}

function PublicationsSection({ doc }: { doc: ResumeDoc }) {
  return (
    <section className="resume-section">
      <SectionTitle>Publications</SectionTitle>
      <ol className="resume-pubs">
        {doc.publications.map((p) => (
          <li key={p.id}>
            {p.url ? <a href={p.url}>{p.citation}</a> : p.citation}
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * Bullet text supports `**bold**` to emphasize impact metrics.
 * The AI is instructed to wrap key numbers/scale/percentages in `**...**`,
 * the editor textarea round-trips the raw markdown, and this renderer
 * converts pairs of asterisks into <strong>. Anything that isn't a
 * complete pair is left as plain text — robust to half-typed input.
 */
function renderBulletWithEmphasis(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*\n]+?\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={i} className="resume-emph">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function prettyUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname.replace(/\/$/, "")}`;
  } catch {
    return url;
  }
}

/**
 * The single source of truth for resume typography. Used in three
 * places: the editor preview <style> tag, the print page <style>, and
 * the PDF route's HTML wrapper. Keep them on this one constant so they
 * never drift.
 *
 * Sizes are pt-based to match how PDF renders treat the page. The
 * editor preview reads them as CSS pt and they look identical because
 * the page is rendered at 96dpi with 1:1 scaling before transform.
 */
export const RESUME_PRINT_CSS = `
  .resume-doc {
    color: #000;
    background: #fff;
    font-family: "Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif;
    font-size: 10.5pt;
    line-height: 1.4;
    padding: 0.6in 0.7in;
    box-sizing: border-box;
    /* Lock the page width even when sitting inside a flex container —
       without this the preview shrinks below 8.5in on small screens. */
    flex-shrink: 0;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .resume-doc * { box-sizing: border-box; }
  .resume-doc a { color: inherit; text-decoration: none; }

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
  /* Emphasize impact metrics inside bullets — bold pulls the eye to
     numbers/percentages/scale, which is the whole point of an impact
     bullet. ATS parsers ignore the styling and read the text fine. */
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
    @page { size: ${"letter"}; margin: 0; }
    html, body { margin: 0; padding: 0; background: #fff; }
    .resume-doc { box-shadow: none !important; }
  }
`;
