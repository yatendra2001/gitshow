/* eslint-disable @next/next/no-img-element */
"use client";

import Markdown from "react-markdown";
import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { useResume, useHandle } from "@/components/data-provider";
import { allSocials } from "@gitshow/shared/resume";

/**
 * Terminal — a portfolio that lives in a terminal.
 *
 * Real macOS window chrome, an ASCII banner with a typewriter intro,
 * sections rendered as `$ command` followed by realistic output
 * (file trees, formatted tables, log lines), syntax-highlighted
 * code-style blocks, and a vim-style status bar at the bottom that
 * reports cursor line, language, and "buffer".
 *
 * Best for: backend, infra, security, and anyone who'd rather see
 * `cat resume.md` than a hero unit.
 */

const FG = "#d4d4d4"; // soft white — vscode dark default text
const FG_DIM = "#7d7d7d";
const FG_FAINT = "#4a4a4a";
const ACCENT = "#7fff7f"; // classic green prompt
const STR = "#a3e26b"; // strings — soft green
const KEY = "#79b8ff"; // keys / paths — blue
const NUM = "#f6c177"; // numbers — orange
const KEYWORD = "#c586c0"; // keywords — purple
const LINK = "#9cdcfe"; // links — light blue
const ERR = "#f48771"; // errors — soft red

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
        background: "#0d1117",
        color: FG,
        fontSize: "13.5px",
        lineHeight: "1.6",
      }}
    >
      <Scanline />

      <div className="mx-auto max-w-[1100px] px-3 sm:px-6 py-6 sm:py-10">
        {/* Window chrome */}
        <Window title={`${handle}@portfolio:~`}>
          <Banner name={r.person.name} />

          {/* whoami */}
          <Block command={`whoami --verbose`}>
            <Whoami r={r} handle={handle} />
          </Block>

          {/* about */}
          <Block command={`cat about.md | less`} sectionId="about" onView={setActiveSection}>
            <About summary={r.person.summary} />
          </Block>

          {/* work */}
          {!hidden.has("work") && r.work.length > 0 && (
            <Block
              command={`git log --author="${r.person.name.split(" ")[0]}" --pretty=full`}
              sectionId="work"
              onView={setActiveSection}
            >
              <WorkLog work={r.work} />
            </Block>
          )}

          {/* education */}
          {!hidden.has("education") && r.education.length > 0 && (
            <Block command={`ls -la education/`} sectionId="education" onView={setActiveSection}>
              <EducationList education={r.education} />
            </Block>
          )}

          {/* skills */}
          {r.skills.length > 0 && (
            <Block command={`tree skills/ -L 1 | column`} sectionId="skills" onView={setActiveSection}>
              <SkillsTree skills={r.skills} />
            </Block>
          )}

          {/* projects */}
          {!hidden.has("projects") && r.projects.length > 0 && (
            <Block command={`gh repo list --limit ${r.projects.length}`} sectionId="projects" onView={setActiveSection}>
              <ProjectsList projects={r.projects.slice(0, 12)} />
            </Block>
          )}

          {/* hackathons */}
          {!hidden.has("hackathons") && r.hackathons.length > 0 && (
            <Block
              command={`tail -n ${r.hackathons.length} hackathons.log`}
              sectionId="hackathons"
              onView={setActiveSection}
            >
              <HackathonsLog hackathons={r.hackathons} />
            </Block>
          )}

          {/* publications */}
          {!hidden.has("publications") && r.publications.length > 0 && (
            <Block
              command={`bibtex --list publications/`}
              sectionId="publications"
              onView={setActiveSection}
            >
              <PublicationsBibtex publications={r.publications} />
            </Block>
          )}

          {/* build log */}
          {!hidden.has("buildLog") && r.buildLog.length > 0 && (
            <Block
              command={`git log --graph --oneline --all | head -20`}
              sectionId="buildLog"
              onView={setActiveSection}
            >
              <BuildLogGraph buildLog={r.buildLog.slice(0, 18)} />
            </Block>
          )}

          {/* contact */}
          <Block command={`cat ~/.contacts`} sectionId="contact" onView={setActiveSection}>
            <Contacts email={r.contact.email} socials={socials} />
          </Block>

          {/* end-of-file prompt */}
          <div className="mt-8 flex items-center gap-2">
            <Prompt user={handle} cwd="~" />
            <Cursor />
          </div>
        </Window>
      </div>

      {/* vim-style status bar at bottom of viewport */}
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
      className="rounded-lg overflow-hidden border border-[#30363d] shadow-[0_25px_60px_-15px_rgba(0,0,0,0.5)]"
      style={{ background: "#0d1117" }}
    >
      <header
        className="flex items-center px-4 py-2.5 border-b border-[#30363d] select-none"
        style={{ background: "#161b22" }}
      >
        <div className="flex items-center gap-1.5">
          <span className="size-3 rounded-full bg-[#ff5f56]" />
          <span className="size-3 rounded-full bg-[#ffbd2e]" />
          <span className="size-3 rounded-full bg-[#27c93f]" />
        </div>
        <div className="flex-1 text-center text-[11px]" style={{ color: FG_DIM }}>
          {title}
        </div>
        <div className="text-[11px] font-bold tracking-wider" style={{ color: FG_FAINT }}>
          bash · 80×24
        </div>
      </header>
      <div
        className="p-5 sm:p-7 pb-32 selection:bg-[#264f78]"
        style={{ caretColor: ACCENT }}
      >
        {children}
      </div>
    </motion.div>
  );
}

/* ─────────────────────────  Banner with typewriter  ────────────────────────── */

const BANNER_LINES = [
  "  ___     _ _   ___ _",
  " / __|___| | |_/ __| |_  _____ __ __",
  "| (__/ -_) |  _\\__ \\ ' \\/ _ \\ V  V /",
  " \\___\\___|_|\\__|___/_||_\\___/\\_/\\_/",
];

function Banner({ name }: { name: string }) {
  const [done, setDone] = useState(false);
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="mb-6"
    >
      <pre
        className="text-[10px] sm:text-[11.5px] leading-[1.1] font-bold whitespace-pre"
        style={{ color: ACCENT }}
        aria-hidden
      >
        {BANNER_LINES.join("\n")}
      </pre>
      <div className="mt-3 text-[12.5px]" style={{ color: FG_DIM }}>
        Welcome, <span style={{ color: FG }}>{name}</span>. Last login:{" "}
        <Typewriter
          text={new Date().toUTCString().replace("GMT", "UTC")}
          delay={400}
          onDone={() => setDone(true)}
        />
        {done && (
          <>
            {" — "}
            <span style={{ color: STR }}>{"42 sessions"}</span>{" since boot."}
          </>
        )}
      </div>
    </motion.div>
  );
}

function Typewriter({
  text,
  delay = 0,
  onDone,
}: {
  text: string;
  delay?: number;
  onDone?: () => void;
}) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const start = setTimeout(() => {
      const id = setInterval(() => {
        setI((prev) => {
          if (prev >= text.length) {
            clearInterval(id);
            onDone?.();
            return prev;
          }
          return prev + 1;
        });
      }, 20);
      return () => clearInterval(id);
    }, delay);
    return () => clearTimeout(start);
  }, [text, delay, onDone]);
  return (
    <span style={{ color: NUM }}>
      {text.slice(0, i)}
      {i < text.length && <span className="opacity-50">|</span>}
    </span>
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
      className="mt-7 first:mt-0"
    >
      <div className="flex items-baseline gap-2">
        <span style={{ color: ACCENT }}>$</span>
        <span style={{ color: FG }}>{command}</span>
      </div>
      <div className="mt-2 pl-4 border-l border-[#21262d]">{children}</div>
    </motion.section>
  );
}

/* ─────────────────────────  whoami output  ────────────────────────── */

function Whoami({ r, handle }: { r: ReturnType<typeof useResume>; handle: string }) {
  const fields: Array<[string, React.ReactNode]> = [
    ["uid", <span style={{ color: NUM }}>{1000}</span>],
    ["name", <span style={{ color: STR }}>"{r.person.name}"</span>],
    ["handle", <span style={{ color: STR }}>"@{handle}"</span>],
    ...(r.person.location
      ? ([["location", <span style={{ color: STR }}>"{r.person.location}"</span>]] as Array<[string, React.ReactNode]>)
      : []),
    ["bio", <span style={{ color: STR }}>"{r.person.description}"</span>],
    ...(r.contact.email
      ? ([
          [
            "email",
            <a
              key="email"
              href={`mailto:${r.contact.email}`}
              style={{ color: LINK }}
              className="underline-offset-2 hover:underline"
            >
              {r.contact.email}
            </a>,
          ],
        ] as Array<[string, React.ReactNode]>)
      : []),
  ];
  return (
    <pre className="whitespace-pre-wrap font-mono">
      <span style={{ color: KEYWORD }}>{"const "}</span>
      <span style={{ color: KEY }}>me</span>
      <span style={{ color: FG }}>{" = "}</span>
      <span style={{ color: FG }}>{`{`}</span>
      {"\n"}
      {fields.map(([k, v], i) => (
        <span key={k}>
          {"  "}
          <span style={{ color: KEY }}>{k}</span>
          <span style={{ color: FG }}>{": "}</span>
          {v}
          {i < fields.length - 1 ? "," : ""}
          {"\n"}
        </span>
      ))}
      <span style={{ color: FG }}>{`}`}</span>
      <span style={{ color: FG_DIM }}>{`;  // 1 row in 0.001s`}</span>
    </pre>
  );
}

/* ─────────────────────────  about ────────────────────────── */

function About({ summary }: { summary: string }) {
  return (
    <article
      className="prose-invert max-w-prose [&_p]:mb-3 [&_p:last-child]:mb-0"
      style={{ color: FG }}
    >
      <Markdown
        components={{
          p: ({ children }) => (
            <p style={{ color: FG, marginBottom: "0.75rem" }}>{children}</p>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              style={{ color: LINK }}
              className="underline-offset-2 hover:underline"
            >
              {children}
            </a>
          ),
          strong: ({ children }) => (
            <strong style={{ color: ACCENT, fontWeight: 700 }}>{children}</strong>
          ),
          em: ({ children }) => (
            <em style={{ color: NUM, fontStyle: "italic" }}>{children}</em>
          ),
          code: ({ children }) => (
            <code
              style={{
                color: STR,
                background: "#161b22",
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

/* ─────────────────────────  work — git log style ────────────────────────── */

function WorkLog({ work }: { work: ReturnType<typeof useResume>["work"] }) {
  return (
    <div className="space-y-5">
      {work.map((w, i) => {
        const sha = pseudoSha(w.id, i);
        return (
          <article key={w.id}>
            <div>
              <span style={{ color: NUM }}>commit {sha}</span>
              {i === 0 && (
                <span style={{ color: ACCENT }} className="ml-2">
                  (HEAD →{" "}
                  <span style={{ color: KEYWORD }}>career</span>, current)
                </span>
              )}
            </div>
            <div>
              <span style={{ color: FG_DIM }}>Author: </span>
              <span>{w.title}</span>
              <span style={{ color: FG_DIM }}>{" <at> "}</span>
              <span style={{ color: STR }}>{w.company}</span>
            </div>
            <div>
              <span style={{ color: FG_DIM }}>Date:   </span>
              <span style={{ color: NUM }}>
                {w.start} → {w.end}
              </span>
              {w.location && (
                <span style={{ color: FG_DIM }}> · {w.location}</span>
              )}
            </div>
            {w.description && (
              <div className="mt-2 pl-4">
                <Markdown
                  components={{
                    p: ({ children }) => (
                      <p style={{ color: FG, marginBottom: "0.5rem" }}>
                        {children}
                      </p>
                    ),
                    a: ({ href, children }) => (
                      <a href={href} style={{ color: LINK }} className="hover:underline">
                        {children}
                      </a>
                    ),
                    ul: ({ children }) => (
                      <ul className="list-none space-y-1">{children}</ul>
                    ),
                    li: ({ children }) => (
                      <li className="pl-3 relative">
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
            {w.badges && w.badges.length > 0 && (
              <div className="mt-2 pl-4 text-[12px]">
                <span style={{ color: FG_DIM }}>Tags: </span>
                {w.badges.map((b, k) => (
                  <span key={b}>
                    <span style={{ color: STR }}>{b}</span>
                    {k < w.badges.length - 1 && (
                      <span style={{ color: FG_DIM }}>, </span>
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

/* ─────────────────────────  education — ls -la ────────────────────────── */

function EducationList({
  education,
}: {
  education: ReturnType<typeof useResume>["education"];
}) {
  return (
    <pre className="whitespace-pre-wrap text-[12.5px] leading-[1.7]">
      <div style={{ color: FG_DIM }}>
        total {education.length}
      </div>
      {education.map((e) => {
        const perms = "drwxr-xr-x";
        const yearRange = `${e.start.match(/\d{4}/)?.[0] ?? "----"}–${e.end.match(/\d{4}/)?.[0] ?? "----"}`;
        return (
          <div key={e.id} className="flex items-baseline gap-3 flex-wrap">
            <span style={{ color: ACCENT }}>{perms}</span>
            <span style={{ color: NUM }}>1</span>
            <span style={{ color: KEY }}>student</span>
            <span style={{ color: KEY }}>academia</span>
            <span style={{ color: NUM }} className="tabular-nums">
              4.0K
            </span>
            <span style={{ color: NUM }} className="tabular-nums">
              {yearRange}
            </span>
            <span style={{ color: STR }}>{e.school}/</span>
            <span style={{ color: FG_DIM }}>· {e.degree}</span>
          </div>
        );
      })}
    </pre>
  );
}

/* ─────────────────────────  skills — tree + column  ────────────────────────── */

function SkillsTree({
  skills,
}: {
  skills: ReturnType<typeof useResume>["skills"];
}) {
  // 3 columns of skills, like `column`
  const cols = 3;
  const padded = [...skills];
  while (padded.length % cols !== 0) padded.push({ name: "" });
  const rows: typeof skills[] = [];
  const perCol = Math.ceil(padded.length / cols);
  for (let i = 0; i < perCol; i++) {
    const row: typeof skills = [];
    for (let c = 0; c < cols; c++) row.push(padded[c * perCol + i] ?? { name: "" });
    rows.push(row);
  }

  return (
    <div className="text-[13px]">
      <div className="grid gap-x-6" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
        {rows.flatMap((row, r) =>
          row.map((s, c) =>
            s.name ? (
              <div key={`${r}-${c}`} className="flex items-baseline justify-between gap-2 truncate">
                <span>
                  <span style={{ color: ACCENT }}>{c === 0 ? "├──" : c === cols - 1 ? "└──" : "├──"}</span>{" "}
                  <span style={{ color: STR }}>{s.name}</span>
                </span>
                {s.usageCount && (
                  <span style={{ color: FG_DIM }} className="tabular-nums">
                    ({s.usageCount})
                  </span>
                )}
              </div>
            ) : (
              <div key={`${r}-${c}`} />
            ),
          ),
        )}
      </div>
      <div className="mt-3 text-[12px]" style={{ color: FG_DIM }}>
        {skills.length} packages installed; latest sync just now.
      </div>
    </div>
  );
}

/* ─────────────────────────  projects — gh repo list  ────────────────────────── */

function ProjectsList({
  projects,
}: {
  projects: ReturnType<typeof useResume>["projects"];
}) {
  return (
    <div className="text-[13px] space-y-3">
      {projects.map((p) => {
        const slug = p.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        return (
          <article key={p.id} className="border-l-2 border-[#21262d] pl-3">
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
              <a
                href={p.href ?? "#"}
                target="_blank"
                rel="noreferrer"
                style={{ color: LINK }}
                className="hover:underline underline-offset-2"
              >
                @me/{slug}
              </a>
              <span className="text-[12px]" style={{ color: NUM }}>
                {p.dates}
              </span>
            </div>
            {p.active && (
              <span
                className="inline-block text-[10px] uppercase tracking-wider px-1.5 mt-1"
                style={{ color: "#0d1117", background: ACCENT, fontWeight: 700 }}
              >
                public · active
              </span>
            )}
            <div className="mt-1.5" style={{ color: FG }}>
              <span style={{ color: FG_DIM }}>description</span>
              <span style={{ color: FG_DIM }}>: </span>
              <span>{stripMd(p.description).split("\n")[0]}</span>
            </div>
            {p.technologies.length > 0 && (
              <div className="text-[12.5px]">
                <span style={{ color: FG_DIM }}>language</span>
                <span style={{ color: FG_DIM }}>: </span>
                {p.technologies.slice(0, 6).map((t, i) => (
                  <span key={t}>
                    <span style={{ color: STR }}>{t}</span>
                    {i < Math.min(p.technologies.length, 6) - 1 && (
                      <span style={{ color: FG_DIM }}>, </span>
                    )}
                  </span>
                ))}
              </div>
            )}
            {p.links && p.links.length > 0 && (
              <div className="text-[12.5px] mt-1">
                <span style={{ color: FG_DIM }}>links</span>
                <span style={{ color: FG_DIM }}>: </span>
                {p.links.map((l, i) => (
                  <span key={l.href}>
                    <a
                      href={l.href}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: LINK }}
                      className="hover:underline underline-offset-2"
                    >
                      {l.label}
                    </a>
                    {i < p.links.length - 1 && (
                      <span style={{ color: FG_DIM }}> | </span>
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

/* ─────────────────────────  hackathons — tail -n hackathons.log ────────────────────────── */

function HackathonsLog({
  hackathons,
}: {
  hackathons: ReturnType<typeof useResume>["hackathons"];
}) {
  return (
    <pre className="whitespace-pre-wrap text-[12.5px] leading-[1.65]">
      {hackathons.map((h) => (
        <div key={h.id}>
          <span style={{ color: NUM }} className="tabular-nums">
            [{(h.date ?? "----").padEnd(11, " ")}]
          </span>
          <span style={{ color: ACCENT }}> INFO </span>
          <span style={{ color: KEY }}>{h.title}</span>
          {h.rank && (
            <>
              {"  "}
              <span style={{ color: STR }}>★ {h.rank}</span>
            </>
          )}
          {h.location && (
            <>
              {"  "}
              <span style={{ color: FG_DIM }}>· {h.location}</span>
            </>
          )}
          {h.description && (
            <div className="pl-2" style={{ color: FG }}>
              {h.description}
            </div>
          )}
        </div>
      ))}
    </pre>
  );
}

/* ─────────────────────────  publications — bibtex-ish  ────────────────────────── */

function PublicationsBibtex({
  publications,
}: {
  publications: ReturnType<typeof useResume>["publications"];
}) {
  return (
    <div className="space-y-4 text-[12.5px]">
      {publications.map((p, i) => {
        const cite = `${(p.kind || "ref").slice(0, 3)}${i + 1}_${(p.title.split(" ")[0] || "ref").toLowerCase()}`;
        return (
          <div key={p.id}>
            <div>
              <span style={{ color: KEYWORD }}>@{p.kind}</span>
              <span style={{ color: FG }}>{`{`}</span>
              <span style={{ color: NUM }}>{cite}</span>
              <span style={{ color: FG }}>,</span>
            </div>
            <div className="pl-4">
              <span style={{ color: KEY }}>title</span>
              <span style={{ color: FG }}>{" = "}</span>
              <a
                href={p.url}
                target="_blank"
                rel="noreferrer"
                className="hover:underline underline-offset-2"
                style={{ color: LINK }}
              >
                "{p.title}"
              </a>
              <span style={{ color: FG }}>,</span>
            </div>
            {p.venue && (
              <div className="pl-4">
                <span style={{ color: KEY }}>venue</span>
                <span style={{ color: FG }}>{" = "}</span>
                <span style={{ color: STR }}>"{p.venue}"</span>
                <span style={{ color: FG }}>,</span>
              </div>
            )}
            {p.publishedAt && (
              <div className="pl-4">
                <span style={{ color: KEY }}>year</span>
                <span style={{ color: FG }}>{" = "}</span>
                <span style={{ color: NUM }}>{p.publishedAt}</span>
                <span style={{ color: FG }}>,</span>
              </div>
            )}
            {p.coAuthors && p.coAuthors.length > 0 && (
              <div className="pl-4">
                <span style={{ color: KEY }}>coauthors</span>
                <span style={{ color: FG }}>{" = "}</span>
                <span style={{ color: STR }}>"{p.coAuthors.join(", ")}"</span>
              </div>
            )}
            <div>
              <span style={{ color: FG }}>{`}`}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────────  build log — git log graph  ────────────────────────── */

function BuildLogGraph({
  buildLog,
}: {
  buildLog: ReturnType<typeof useResume>["buildLog"];
}) {
  return (
    <pre className="whitespace-pre text-[12.5px] leading-[1.55] overflow-x-auto">
      {buildLog.map((b, i) => {
        const sha = pseudoSha(b.id, i).slice(0, 7);
        const branch = i % 4 === 0 ? "main" : i % 4 === 1 ? "feat" : "refactor";
        return (
          <div key={b.id} className="grid grid-cols-[16px_70px_60px_1fr] gap-2 items-baseline">
            <span style={{ color: ACCENT }}>{i === 0 ? "*" : "│"}</span>
            <span style={{ color: NUM }} className="tabular-nums">
              {sha}
            </span>
            <span style={{ color: b.languageColor ?? STR }}>({branch})</span>
            <span>
              <span style={{ color: KEY }}>{b.title}</span>
              <span style={{ color: FG_DIM }}>: </span>
              <span style={{ color: FG }}>{b.description}</span>
            </span>
          </div>
        );
      })}
    </pre>
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
  const items: Array<{ key: string; value: string; href?: string }> = [];
  if (email) items.push({ key: "email", value: email, href: `mailto:${email}` });
  for (const s of socials) {
    items.push({ key: s.name.toLowerCase(), value: prettyUrl(s.url), href: s.url });
  }
  return (
    <pre className="whitespace-pre-wrap text-[12.5px]">
      <div style={{ color: FG_DIM }}># ~/.contacts — last updated just now</div>
      <div style={{ color: FG_DIM }}># cat | sort -k1</div>
      <div className="mt-2">
        {items.map((it) => (
          <div key={it.key}>
            <span style={{ color: KEY }} className="inline-block w-32">
              {it.key}
            </span>
            <span style={{ color: FG_DIM }}> = </span>
            {it.href ? (
              <a
                href={it.href}
                target={it.href.startsWith("mailto:") ? undefined : "_blank"}
                rel="noreferrer"
                style={{ color: LINK }}
                className="hover:underline underline-offset-2"
              >
                {it.value}
              </a>
            ) : (
              <span style={{ color: STR }}>{it.value}</span>
            )}
          </div>
        ))}
      </div>
    </pre>
  );
}

/* ─────────────────────────  prompt + cursor  ────────────────────────── */

function Prompt({ user, cwd }: { user: string; cwd: string }) {
  return (
    <span className="font-bold">
      <span style={{ color: KEYWORD }}>{user}</span>
      <span style={{ color: FG_DIM }}>@</span>
      <span style={{ color: NUM }}>portfolio</span>
      <span style={{ color: FG_DIM }}>:</span>
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
      className="fixed bottom-0 inset-x-0 z-30 select-none"
      style={{ background: "#1f2428" }}
    >
      <div className="mx-auto max-w-[1400px] px-3 sm:px-6 py-1.5 flex items-center justify-between text-[11px] gap-3">
        <div className="flex items-center gap-3">
          <span
            className="px-2 py-0.5 font-bold uppercase tracking-wider"
            style={{ background: ACCENT, color: "#0d1117" }}
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
          <span className="tabular-nums">
            {section}:{totalLines} lines
          </span>
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
          "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.018) 3px)",
      }}
    />
  );
}

/* ─────────────────────────  Helpers  ────────────────────────── */

function pseudoSha(id: string, salt: number): string {
  // Deterministic pseudo SHA — looks like a git hash, derived from id
  let h = salt;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0").slice(0, 7).padEnd(40, "f");
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
    r.publications.length * 4 +
    r.buildLog.length +
    r.education.length * 2 +
    r.hackathons.length * 2 +
    20
  );
}
