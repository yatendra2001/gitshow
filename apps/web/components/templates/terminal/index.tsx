/* eslint-disable @next/next/no-img-element */
"use client";

import Markdown from "react-markdown";
import { useEffect, useState } from "react";
import { useResume, useHandle } from "@/components/data-provider";
import { allSocials } from "@gitshow/shared/resume";

/**
 * Terminal — a CLI-rendered portfolio.
 *
 * Treats the whole page like the output of `cat resume.md` in a green-on-
 * black 80-column terminal. Sections are headed with `## section_name`,
 * lists use `>` prompts and ASCII dashes, and a blinking cursor follows
 * the contact section. Best for backend / infra / security folks.
 */
export default function TerminalTemplate() {
  const r = useResume();
  const handle = useHandle();
  const hidden = new Set(r.sections.hidden);
  const socials = allSocials(r);

  return (
    <div className="min-h-dvh bg-[#0b0f0a] text-[#7fff7f] font-mono text-[13px] leading-[1.55] selection:bg-[#7fff7f] selection:text-[#0b0f0a]">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8 sm:py-12">
        <TerminalHeader handle={handle} />

        <Section label="whoami" delay={0}>
          <div className="space-y-1">
            <Line>name        : <span className="text-white">{r.person.name}</span></Line>
            <Line>handle      : <span className="text-white">@{handle}</span></Line>
            {r.person.location && (
              <Line>location    : <span className="text-white">{r.person.location}</span></Line>
            )}
            {r.contact.email && (
              <Line>email       : <a href={`mailto:${r.contact.email}`} className="text-[#9bff9b] underline-offset-2 hover:underline">{r.contact.email}</a></Line>
            )}
            <Line className="pt-2">{r.person.description}</Line>
          </div>
        </Section>

        <Section label="cat about.md" delay={1}>
          <div className="prose-terminal">
            <Markdown
              components={{
                a: ({ href, children }) => (
                  <a href={href} className="text-[#9bff9b] underline-offset-2 hover:underline">
                    {children}
                  </a>
                ),
                p: ({ children }) => <p className="mb-3 last:mb-0 text-[#bdf7bd]">{children}</p>,
                strong: ({ children }) => <strong className="text-white font-bold">{children}</strong>,
                em: ({ children }) => <em className="text-[#7fff7f] italic">{children}</em>,
              }}
            >
              {r.person.summary}
            </Markdown>
          </div>
        </Section>

        {!hidden.has("work") && r.work.length > 0 && (
          <Section label="ls -la work/" delay={2}>
            <div className="space-y-4">
              {r.work.map((w) => (
                <article key={w.id} className="border-l border-[#1f3320] pl-3">
                  <header className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="text-white font-bold">
                      {w.title} <span className="text-[#7fff7f]">@</span> {w.company}
                    </div>
                    <div className="text-[#5fa05f] tabular-nums text-[12px]">
                      {w.start} → {w.end}
                    </div>
                  </header>
                  {w.location && <div className="text-[#5fa05f] text-[12px]">{w.location}</div>}
                  {w.description && (
                    <div className="mt-2 text-[#bdf7bd] prose-terminal">
                      <Markdown
                        components={{
                          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                          a: ({ href, children }) => (
                            <a href={href} className="text-[#9bff9b] hover:underline">{children}</a>
                          ),
                          ul: ({ children }) => <ul className="list-none space-y-1">{children}</ul>,
                          li: ({ children }) => (
                            <li className="pl-3 relative before:content-['>'] before:absolute before:left-0 before:text-[#7fff7f]">
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
          </Section>
        )}

        {!hidden.has("education") && r.education.length > 0 && (
          <Section label="ls education/" delay={3}>
            <div className="space-y-2">
              {r.education.map((e) => (
                <div key={e.id} className="flex flex-wrap items-baseline justify-between gap-2 border-l border-[#1f3320] pl-3">
                  <div>
                    <div className="text-white font-bold">{e.school}</div>
                    <div className="text-[#bdf7bd]">{e.degree}</div>
                  </div>
                  <div className="text-[#5fa05f] tabular-nums text-[12px]">{e.start} → {e.end}</div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {r.skills.length > 0 && (
          <Section label="grep -h skills/*" delay={4}>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {r.skills.map((s) => (
                <span key={s.name} className="text-[#bdf7bd]">
                  <span className="text-[#7fff7f]">+</span> {s.name}
                  {s.usageCount && (
                    <span className="text-[#5fa05f] ml-1">({s.usageCount})</span>
                  )}
                </span>
              ))}
            </div>
          </Section>
        )}

        {!hidden.has("projects") && r.projects.length > 0 && (
          <Section label="find ./projects -type f" delay={5}>
            <div className="space-y-4">
              {r.projects.slice(0, 12).map((p) => (
                <article key={p.id} className="border-l border-[#1f3320] pl-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <span className="text-[#7fff7f]">$</span>{" "}
                      <a href={p.href ?? "#"} target="_blank" rel="noreferrer" className="text-white font-bold hover:underline underline-offset-2">
                        {p.title}
                      </a>
                      {p.active && (
                        <span className="ml-2 text-[#9bff9b]">[active]</span>
                      )}
                    </div>
                    <div className="text-[#5fa05f] tabular-nums text-[12px]">{p.dates}</div>
                  </div>
                  <div className="mt-1 text-[#bdf7bd] prose-terminal">
                    <Markdown
                      components={{
                        p: ({ children }) => <p>{children}</p>,
                        a: ({ href, children }) => (
                          <a href={href} className="text-[#9bff9b] hover:underline">{children}</a>
                        ),
                      }}
                    >
                      {p.description}
                    </Markdown>
                  </div>
                  {p.technologies.length > 0 && (
                    <div className="mt-1 text-[12px] text-[#5fa05f]">
                      tech: {p.technologies.join(", ")}
                    </div>
                  )}
                  {p.links.length > 0 && (
                    <div className="mt-1 text-[12px] flex flex-wrap gap-x-3">
                      {p.links.map((l) => (
                        <a key={l.href} href={l.href} target="_blank" rel="noreferrer" className="text-[#9bff9b] hover:underline">
                          [{l.label}]
                        </a>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
          </Section>
        )}

        {!hidden.has("hackathons") && r.hackathons.length > 0 && (
          <Section label="cat hackathons.log" delay={6}>
            <div className="space-y-2">
              {r.hackathons.map((h) => (
                <div key={h.id} className="border-l border-[#1f3320] pl-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="text-white font-bold">{h.title}</div>
                    {h.date && <div className="text-[#5fa05f] tabular-nums text-[12px]">{h.date}</div>}
                  </div>
                  {h.rank && <div className="text-[#9bff9b]">→ {h.rank}</div>}
                  {h.description && <div className="text-[#bdf7bd]">{h.description}</div>}
                </div>
              ))}
            </div>
          </Section>
        )}

        {!hidden.has("publications") && r.publications.length > 0 && (
          <Section label="ls publications/" delay={7}>
            <div className="space-y-2">
              {r.publications.map((p) => (
                <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="block border-l border-[#1f3320] pl-3 hover:border-[#7fff7f] transition-colors">
                  <div className="text-white font-bold">[{p.kind}] {p.title}</div>
                  {p.venue && <div className="text-[#bdf7bd] text-[12px]">{p.venue}{p.publishedAt ? ` · ${p.publishedAt}` : ""}</div>}
                </a>
              ))}
            </div>
          </Section>
        )}

        {!hidden.has("buildLog") && r.buildLog.length > 0 && (
          <Section label="git log --all --oneline" delay={8}>
            <div className="space-y-1">
              {r.buildLog.slice(0, 30).map((b) => (
                <div key={b.id} className="flex flex-wrap items-baseline gap-x-3 text-[12.5px]">
                  <span className="text-[#5fa05f] tabular-nums w-24 flex-none">{b.dates}</span>
                  <span
                    aria-hidden
                    className="inline-block size-2 rounded-full flex-none"
                    style={{ backgroundColor: b.languageColor ?? "#7fff7f" }}
                  />
                  <span className="text-white font-bold">{b.title}</span>
                  <span className="text-[#bdf7bd]">— {b.description}</span>
                </div>
              ))}
            </div>
          </Section>
        )}

        <Section label="contact --list" delay={9}>
          <div className="space-y-1">
            {socials.map((s) => (
              <Line key={s.url}>
                <span className="text-[#5fa05f]">{s.name.padEnd(12, " ")}</span>{" "}
                <a href={s.url} target="_blank" rel="noreferrer" className="text-[#9bff9b] hover:underline">
                  {s.url}
                </a>
              </Line>
            ))}
            {r.contact.email && (
              <Line>
                <span className="text-[#5fa05f]">{"email".padEnd(12, " ")}</span>{" "}
                <a href={`mailto:${r.contact.email}`} className="text-[#9bff9b] hover:underline">
                  {r.contact.email}
                </a>
              </Line>
            )}
          </div>
        </Section>

        <div className="mt-10 flex items-center text-[#7fff7f]">
          <span>$</span>
          <Cursor />
        </div>
      </div>
    </div>
  );
}

function TerminalHeader({ handle }: { handle: string }) {
  return (
    <header className="mb-6 -mx-4 sm:-mx-8 border-y border-[#1f3320]">
      <div className="px-4 sm:px-8 py-2 flex items-center justify-between text-[12px]">
        <div className="flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-[#ff5f56]" />
          <span className="size-2.5 rounded-full bg-[#ffbd2e]" />
          <span className="size-2.5 rounded-full bg-[#27c93f]" />
          <span className="ml-3 text-[#5fa05f]">~/portfolio/{handle}</span>
        </div>
        <span className="text-[#5fa05f]">bash</span>
      </div>
    </header>
  );
}

function Section({
  label,
  children,
  delay = 0,
}: {
  label: string;
  children: React.ReactNode;
  delay?: number;
}) {
  return (
    <section
      className="mt-8 first:mt-0 animate-[term-fade_0.4s_ease-out_both]"
      style={{ animationDelay: `${delay * 60}ms` }}
    >
      <h2 className="mb-3 text-white">
        <span className="text-[#7fff7f]">$</span> {label}
      </h2>
      <div className="pl-3">{children}</div>
      <div className="mt-3 text-[#1f3320] select-none" aria-hidden>
        ────────────────────────────────────────────────────
      </div>
      <style>{`
        @keyframes term-fade {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </section>
  );
}

function Line({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`text-[#bdf7bd] ${className}`}>{children}</div>;
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
      className={`ml-2 inline-block h-[1.1em] w-[0.55em] align-text-bottom transition-opacity ${on ? "opacity-100" : "opacity-0"} bg-[#7fff7f]`}
    />
  );
}
