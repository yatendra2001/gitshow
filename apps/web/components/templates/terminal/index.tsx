/* eslint-disable @next/next/no-img-element */
"use client";

import Markdown from "react-markdown";
import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { useResume, useHandle } from "@/components/data-provider";
import { allSocials } from "@gitshow/shared/resume";
import { formatResumeDate, formatResumeDateRange } from "@/lib/format-date";

/**
 * Terminal — a portfolio that lives in a terminal.
 *
 * macOS window chrome, a small ASCII banner, and sections rendered as
 * realistic shell commands followed by clean, well-spaced output. The
 * output uses calm syntax accents (one quiet color for keys, one for
 * values, one for links) so the *content* reads first and the styling
 * stays in service of it.
 *
 * Best for: backend, infra, security, and anyone who'd rather see
 * `cat resume.md` than a hero unit.
 */

const FG = "#e6edf3"; // primary text — slightly cooler white
const FG_DIM = "#8b949e"; // secondary text
const FG_FAINT = "#6e7681"; // tertiary
const FG_GHOST = "#30363d"; // borders + subtle separators
const ACCENT = "#7ee787"; // soft green — only for prompts + the cursor
const KEY = "#79c0ff"; // keys / paths — soft blue
const STR = "#a5d6ff"; // string-ish content — lighter blue
const NUM = "#ffa657"; // dates / numbers — muted orange
const LINK = "#79c0ff"; // links — same as keys, underline on hover
const BG = "#0d1117";
const BG_SOFT = "#161b22";

export default function TerminalTemplate() {
  const r = useResume();
  const handle = useHandle();
  const hidden = new Set(r.sections.hidden);
  const socials = allSocials(r);
  const [activeSection, setActiveSection] = useState("about");
  const totalLines = useMemo(() => estimateLines(r), [r]);

  return (
    <div
      className="min-h-dvh font-mono antialiased"
      style={{
        background: BG,
        color: FG,
        fontSize: "14px",
        lineHeight: "1.7",
      }}
    >
      <Scanline />

      <div className="mx-auto max-w-[920px] px-3 sm:px-6 py-6 sm:py-10">
        <Window title={`${handle}@portfolio:~`}>
          <Banner name={r.person.name} location={r.person.location} />

          <Block command="whoami">
            <Whoami r={r} handle={handle} />
          </Block>

          <Block command="cat about.md" sectionId="about" onView={setActiveSection}>
            <About summary={r.person.summary} />
          </Block>

          {!hidden.has("work") && r.work.length > 0 && (
            <Block
              command="git log --pretty=oneline | head"
              sectionId="work"
              onView={setActiveSection}
            >
              <WorkLog work={r.work} />
            </Block>
          )}

          {!hidden.has("projects") && r.projects.length > 0 && (
            <Block
              command="gh repo list --limit 8"
              sectionId="projects"
              onView={setActiveSection}
            >
              <ProjectsList projects={r.projects.slice(0, 8)} />
            </Block>
          )}

          {r.skills.length > 0 && (
            <Block command="ls skills/" sectionId="skills" onView={setActiveSection}>
              <SkillsGrid skills={r.skills} />
            </Block>
          )}

          {!hidden.has("education") && r.education.length > 0 && (
            <Block command="cat education.txt" sectionId="education" onView={setActiveSection}>
              <EducationList education={r.education} />
            </Block>
          )}

          {!hidden.has("hackathons") && r.hackathons.length > 0 && (
            <Block
              command="tail -n 5 hackathons.log"
              sectionId="hackathons"
              onView={setActiveSection}
            >
              <HackathonsLog hackathons={r.hackathons.slice(0, 5)} />
            </Block>
          )}

          {!hidden.has("publications") && r.publications.length > 0 && (
            <Block
              command="ls publications/"
              sectionId="publications"
              onView={setActiveSection}
            >
              <PublicationsList publications={r.publications.slice(0, 6)} />
            </Block>
          )}

          {!hidden.has("buildLog") && r.buildLog.length > 0 && (
            <Block
              command="git log --oneline | head -10"
              sectionId="buildLog"
              onView={setActiveSection}
            >
              <BuildLogList buildLog={r.buildLog.slice(0, 10)} />
            </Block>
          )}

          <Block command="cat ~/.contacts" sectionId="contact" onView={setActiveSection}>
            <Contacts email={r.contact.email} socials={socials} />
          </Block>

          <div className="mt-10 flex items-center gap-2">
            <Prompt user={handle} cwd="~" />
            <Cursor />
          </div>
        </Window>
      </div>

      <StatusBar
        handle={handle}
        section={activeSection}
        totalLines={totalLines}
        version={r.meta.version}
      />
    </div>
  );
}

/* ─────────────────────────  Window chrome  ────────────────────────── */

function Window({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="rounded-lg overflow-hidden border shadow-[0_25px_60px_-15px_rgba(0,0,0,0.5)]"
      style={{ background: BG, borderColor: FG_GHOST }}
    >
      <header
        className="flex items-center px-4 py-2.5 border-b select-none"
        style={{ background: BG_SOFT, borderColor: FG_GHOST }}
      >
        <div className="flex items-center gap-1.5">
          <span className="size-3 rounded-full bg-[#ff5f56]" />
          <span className="size-3 rounded-full bg-[#ffbd2e]" />
          <span className="size-3 rounded-full bg-[#27c93f]" />
        </div>
        <div className="flex-1 text-center text-[12px]" style={{ color: FG_DIM }}>
          {title}
        </div>
        <div className="text-[11px] tracking-wider" style={{ color: FG_FAINT }}>
          bash
        </div>
      </header>
      <div className="p-6 sm:p-8 pb-32 selection:bg-[#264f78]" style={{ caretColor: ACCENT }}>
        {children}
      </div>
    </motion.div>
  );
}

/* ─────────────────────────  Banner  ────────────────────────── */

function Banner({ name, location }: { name: string; location?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="mb-10"
    >
      {/* Big readable name as the actual H1 — not buried in ASCII */}
      <h1 className="text-2xl sm:text-3xl font-bold" style={{ color: FG }}>
        {name}
        <span style={{ color: ACCENT }}>.</span>
      </h1>
      <div className="mt-2 text-[13px]" style={{ color: FG_DIM }}>
        Last login:{" "}
        <span style={{ color: NUM }}>
          {new Date().toUTCString().replace("GMT", "UTC")}
        </span>
        {location && (
          <>
            {" from "}
            <span style={{ color: STR }}>{location}</span>
          </>
        )}
      </div>
    </motion.div>
  );
}

/* ─────────────────────────  Section block  ────────────────────────── */

function Block({
  command,
  children,
  sectionId,
  onView,
}: {
  command: string;
  children: React.ReactNode;
  sectionId?: string;
  onView?: (id: string) => void;
}) {
  return (
    <motion.section
      id={sectionId}
      initial={{ opacity: 0, y: 6 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-30%" }}
      onViewportEnter={() => sectionId && onView?.(sectionId)}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="mt-12 first:mt-0"
    >
      {/* Prompt — clearly the start of a new "command" */}
      <div className="flex items-baseline gap-2 mb-4">
        <span style={{ color: ACCENT }} className="font-bold">
          $
        </span>
        <span style={{ color: FG }} className="text-[14px]">
          {command}
        </span>
      </div>
      {/* Output — indented under the prompt with a faint left rail */}
      <div className="pl-5 border-l" style={{ borderColor: FG_GHOST }}>
        {children}
      </div>
    </motion.section>
  );
}

/* ─────────────────────────  whoami  ────────────────────────── */

function Whoami({ r, handle }: { r: ReturnType<typeof useResume>; handle: string }) {
  const rows: Array<[string, React.ReactNode]> = [
    ["name", <span key="n" style={{ color: STR }}>{r.person.name}</span>],
    ["handle", <span key="h" style={{ color: STR }}>@{handle}</span>],
  ];
  if (r.person.location) {
    rows.push(["location", <span key="l" style={{ color: STR }}>{r.person.location}</span>]);
  }
  if (r.contact.email) {
    rows.push([
      "email",
      <a
        key="e"
        href={`mailto:${r.contact.email}`}
        style={{ color: LINK }}
        className="underline-offset-2 hover:underline"
      >
        {r.contact.email}
      </a>,
    ]);
  }
  return (
    <div className="text-[13.5px] space-y-1.5">
      {rows.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[100px_1fr] gap-2 items-baseline">
          <span style={{ color: FG_DIM }}>{k}</span>
          <span>{v}</span>
        </div>
      ))}
      <div className="pt-2 text-[13px]" style={{ color: FG_DIM }}>
        {r.person.description}
      </div>
    </div>
  );
}

/* ─────────────────────────  about ────────────────────────── */

function About({ summary }: { summary: string }) {
  return (
    <article
      className="max-w-prose [&_p]:mb-3 [&_p:last-child]:mb-0 text-[14px]"
      style={{ color: FG }}
    >
      <Markdown
        components={{
          p: ({ children }) => <p style={{ color: FG }}>{children}</p>,
          a: ({ href, children }) => (
            <a
              href={href}
              style={{ color: LINK }}
              className="underline underline-offset-2 decoration-[#30363d] hover:decoration-current transition-colors"
            >
              {children}
            </a>
          ),
          strong: ({ children }) => (
            <strong style={{ color: FG, fontWeight: 700 }}>{children}</strong>
          ),
          em: ({ children }) => (
            <em style={{ color: FG_DIM, fontStyle: "italic" }}>{children}</em>
          ),
          code: ({ children }) => (
            <code
              style={{
                color: KEY,
                background: BG_SOFT,
                padding: "0.1em 0.4em",
                borderRadius: "3px",
                fontSize: "0.92em",
              }}
            >
              {children}
            </code>
          ),
        }}
      >
        {summary}
      </Markdown>
    </article>
  );
}

/* ─────────────────────────  work — clean git log oneline ────────────────────────── */

function WorkLog({ work }: { work: ReturnType<typeof useResume>["work"] }) {
  return (
    <div className="space-y-6">
      {work.map((w, i) => (
        <article key={w.id}>
          <div className="flex items-baseline gap-3 flex-wrap">
            <span style={{ color: NUM }} className="text-[12.5px] tabular-nums font-bold">
              {sha7(w.id, i)}
            </span>
            {i === 0 && (
              <span
                className="text-[10.5px] px-1.5 py-0.5 rounded uppercase tracking-wider font-bold"
                style={{ background: ACCENT, color: BG }}
              >
                HEAD
              </span>
            )}
            <span style={{ color: FG }} className="font-bold text-[14.5px]">
              {w.title}
            </span>
            <span style={{ color: FG_DIM }}>at</span>
            {w.href ? (
              <a
                href={w.href}
                target="_blank"
                rel="noreferrer"
                style={{ color: LINK }}
                className="underline-offset-2 hover:underline font-bold text-[14.5px]"
              >
                {w.company}
              </a>
            ) : (
              <span style={{ color: STR }} className="font-bold text-[14.5px]">
                {w.company}
              </span>
            )}
          </div>
          <div className="mt-1 text-[12.5px] flex items-center gap-3 flex-wrap" style={{ color: FG_FAINT }}>
            <span className="tabular-nums">
              {formatResumeDateRange(w.start, w.end)}
            </span>
            {w.location && <span>· {w.location}</span>}
          </div>
          {w.description && (
            <div className="mt-3 text-[13.5px] max-w-prose">
              <Markdown
                components={{
                  p: ({ children }) => (
                    <p style={{ color: FG, marginBottom: "0.5rem" }}>{children}</p>
                  ),
                  a: ({ href, children }) => (
                    <a href={href} style={{ color: LINK }} className="hover:underline">
                      {children}
                    </a>
                  ),
                  ul: ({ children }) => (
                    <ul className="list-none space-y-1 mt-1">{children}</ul>
                  ),
                  li: ({ children }) => (
                    <li className="pl-4 relative">
                      <span
                        aria-hidden
                        className="absolute left-0"
                        style={{ color: ACCENT }}
                      >
                        ▸
                      </span>
                      {children}
                    </li>
                  ),
                }}
              >
                {w.description}
              </Markdown>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

/* ─────────────────────────  projects — gh repo list ────────────────────────── */

function ProjectsList({
  projects,
}: {
  projects: ReturnType<typeof useResume>["projects"];
}) {
  return (
    <div className="space-y-4">
      {projects.map((p) => {
        const slug = p.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        return (
          <article key={p.id}>
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
              <a
                href={p.href ?? "#"}
                target="_blank"
                rel="noreferrer"
                style={{ color: LINK }}
                className="font-bold text-[14.5px] hover:underline underline-offset-2"
              >
                @me/{slug}
              </a>
              <span className="text-[12px] tabular-nums" style={{ color: FG_FAINT }}>
                {p.dates}
                {p.active && (
                  <span style={{ color: ACCENT }} className="ml-2 font-bold">
                    ● active
                  </span>
                )}
              </span>
            </div>
            <p className="text-[13.5px] mt-1 max-w-prose" style={{ color: FG }}>
              {stripMd(p.description).split("\n")[0]}
            </p>
            {p.technologies.length > 0 && (
              <div className="text-[12.5px] mt-1.5">
                {p.technologies.slice(0, 6).map((t, i) => (
                  <span key={t}>
                    <span style={{ color: STR }}>{t}</span>
                    {i < Math.min(p.technologies.length, 6) - 1 && (
                      <span style={{ color: FG_FAINT }}>, </span>
                    )}
                  </span>
                ))}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

/* ─────────────────────────  skills — clean grid ────────────────────────── */

function SkillsGrid({
  skills,
}: {
  skills: ReturnType<typeof useResume>["skills"];
}) {
  return (
    <div className="text-[13.5px]">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-8 gap-y-1.5">
        {skills.map((s) => (
          <div
            key={s.name}
            className="flex items-baseline justify-between gap-2 truncate"
          >
            <span style={{ color: STR }}>{s.name}</span>
            {s.usageCount && (
              <span style={{ color: FG_FAINT }} className="text-[11.5px] tabular-nums">
                ×{s.usageCount}
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 text-[12px]" style={{ color: FG_FAINT }}>
        {skills.length} packages installed.
      </div>
    </div>
  );
}

/* ─────────────────────────  education ────────────────────────── */

function EducationList({
  education,
}: {
  education: ReturnType<typeof useResume>["education"];
}) {
  return (
    <div className="space-y-3 text-[13.5px]">
      {education.map((e) => (
        <article key={e.id}>
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <span style={{ color: FG }} className="font-bold">
              {e.school}
            </span>
            <span style={{ color: FG_FAINT }} className="text-[12px] tabular-nums">
              {formatResumeDateRange(e.start, e.end)}
            </span>
          </div>
          <div style={{ color: FG_DIM }} className="text-[13px]">
            {e.degree}
          </div>
        </article>
      ))}
    </div>
  );
}

/* ─────────────────────────  hackathons — clean log lines ────────────────────────── */

function HackathonsLog({
  hackathons,
}: {
  hackathons: ReturnType<typeof useResume>["hackathons"];
}) {
  return (
    <div className="space-y-3 text-[13.5px]">
      {hackathons.map((h) => (
        <article key={h.id}>
          <div className="flex items-baseline gap-3 flex-wrap">
            {h.date && (
              <span style={{ color: NUM }} className="text-[12.5px] tabular-nums">
                {h.date}
              </span>
            )}
            <span style={{ color: FG }} className="font-bold">
              {h.title}
            </span>
            {h.rank && (
              <span style={{ color: ACCENT }}>★ {h.rank}</span>
            )}
          </div>
          {h.description && (
            <p className="text-[13px] mt-0.5" style={{ color: FG_DIM }}>
              {h.description}
            </p>
          )}
        </article>
      ))}
    </div>
  );
}

/* ─────────────────────────  publications  ────────────────────────── */

function PublicationsList({
  publications,
}: {
  publications: ReturnType<typeof useResume>["publications"];
}) {
  return (
    <div className="space-y-3 text-[13.5px]">
      {publications.map((p) => (
        <article key={p.id}>
          <div className="flex items-baseline gap-3 flex-wrap">
            <span
              style={{ color: ACCENT }}
              className="text-[11px] uppercase tracking-wider font-bold"
            >
              [{p.kind}]
            </span>
            <a
              href={p.url}
              target="_blank"
              rel="noreferrer"
              style={{ color: LINK }}
              className="hover:underline underline-offset-2 font-bold"
            >
              {p.title}
            </a>
          </div>
          {p.venue && (
            <div className="text-[12.5px] mt-0.5 italic" style={{ color: FG_DIM }}>
              {p.venue}
              {p.publishedAt && ` · ${formatResumeDate(p.publishedAt)}`}
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

/* ─────────────────────────  build log — single column, no graph noise ────────────────────────── */

function BuildLogList({
  buildLog,
}: {
  buildLog: ReturnType<typeof useResume>["buildLog"];
}) {
  return (
    <div className="space-y-2 text-[13.5px]">
      {buildLog.map((b, i) => (
        <div key={b.id} className="flex items-baseline gap-3">
          <span
            style={{ color: NUM }}
            className="text-[12.5px] tabular-nums font-bold flex-none"
          >
            {sha7(b.id, i)}
          </span>
          <span
            aria-hidden
            className="size-2 rounded-full flex-none translate-y-[3px]"
            style={{ background: b.languageColor ?? FG_DIM }}
          />
          <span className="min-w-0 flex-1 truncate">
            <span style={{ color: FG }} className="font-bold">
              {b.title}
            </span>
            <span style={{ color: FG_DIM }}> — {b.description}</span>
          </span>
          <span
            className="text-[11.5px] tabular-nums hidden sm:inline flex-none"
            style={{ color: FG_FAINT }}
          >
            {b.dates}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────  contacts ────────────────────────── */

function Contacts({
  email,
  socials,
}: {
  email?: string;
  socials: ReturnType<typeof allSocials>;
}) {
  const items: Array<{ key: string; value: string; href: string }> = [];
  if (email) items.push({ key: "email", value: email, href: `mailto:${email}` });
  for (const s of socials) {
    items.push({ key: s.name.toLowerCase(), value: prettyUrl(s.url), href: s.url });
  }
  return (
    <div className="text-[13.5px] space-y-1.5">
      {items.map((it) => (
        <div
          key={it.key}
          className="grid grid-cols-[100px_1fr] gap-2 items-baseline"
        >
          <span style={{ color: FG_DIM }}>{it.key}</span>
          <a
            href={it.href}
            target={it.href.startsWith("mailto:") ? undefined : "_blank"}
            rel="noreferrer"
            style={{ color: LINK }}
            className="hover:underline underline-offset-2 truncate"
          >
            {it.value}
          </a>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────  prompt + cursor  ────────────────────────── */

function Prompt({ user, cwd }: { user: string; cwd: string }) {
  return (
    <span className="font-bold text-[14px]">
      <span style={{ color: ACCENT }}>{user}</span>
      <span style={{ color: FG_FAINT }}>@</span>
      <span style={{ color: NUM }}>portfolio</span>
      <span style={{ color: FG_FAINT }}>:</span>
      <span style={{ color: KEY }}>{cwd}</span>
      <span style={{ color: FG }}>$</span>
    </span>
  );
}

function Cursor() {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const id = setInterval(() => setOn((v) => !v), 530);
    return () => clearInterval(id);
  }, []);
  return (
    <span
      aria-hidden
      className={`inline-block h-[1.2em] w-[0.6em] align-text-bottom ml-1 transition-opacity ${on ? "opacity-100" : "opacity-0"}`}
      style={{ background: ACCENT }}
    />
  );
}

/* ─────────────────────────  status bar  ────────────────────────── */

function StatusBar({
  handle,
  section,
  totalLines,
  version,
}: {
  handle: string;
  section: string;
  totalLines: number;
  version: number;
}) {
  return (
    <div
      className="fixed bottom-0 inset-x-0 z-30 select-none border-t"
      style={{ background: BG_SOFT, borderColor: FG_GHOST }}
    >
      <div className="mx-auto max-w-[1400px] px-3 sm:px-6 py-1.5 flex items-center justify-between text-[11.5px] gap-3">
        <div className="flex items-center gap-3">
          <span
            className="px-2 py-0.5 font-bold uppercase tracking-wider"
            style={{ background: ACCENT, color: BG }}
          >
            NORMAL
          </span>
          <span style={{ color: FG }} className="hidden sm:inline">
            ~/portfolio/{handle}/{section}.md
          </span>
        </div>
        <div className="flex items-center gap-3" style={{ color: FG_DIM }}>
          <span className="hidden sm:inline">utf-8</span>
          <span className="hidden sm:inline">unix</span>
          <span>markdown</span>
          <span className="tabular-nums">v{version}</span>
          <span className="tabular-nums">~{totalLines}L</span>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────  scanline  ────────────────────────── */

function Scanline() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-20"
      style={{
        backgroundImage:
          "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.014) 3px)",
      }}
    />
  );
}

/* ─────────────────────────  Helpers  ────────────────────────── */

function sha7(id: string, salt: number): string {
  let h = (salt + 1) * 2654435761;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) - h + id.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(7, "0").slice(0, 7);
}

function stripMd(s: string): string {
  return s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*_`#>]/g, "");
}

function prettyUrl(u: string): string {
  try {
    const url = new URL(u);
    return url.hostname.replace(/^www\./, "") + url.pathname.replace(/\/$/, "");
  } catch {
    return u;
  }
}

function estimateLines(r: ReturnType<typeof useResume>): number {
  return (
    r.work.length * 4 +
    r.projects.length * 5 +
    r.skills.length +
    r.publications.length * 3 +
    r.buildLog.length +
    r.education.length * 2 +
    r.hackathons.length * 2 +
    20
  );
}
