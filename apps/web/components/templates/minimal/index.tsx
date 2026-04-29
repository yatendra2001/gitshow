/* eslint-disable @next/next/no-img-element */
"use client";

import Markdown from "react-markdown";
import { motion } from "motion/react";
import { useResume, useHandle } from "@/components/data-provider";
import { allSocials } from "@gitshow/shared/resume";
import { ArrowUpRight } from "lucide-react";

/**
 * Minimal — the senior engineer's personal site.
 *
 * Single column, mono everywhere, dotted leader lines for tabular
 * alignment, subtle hover affordances, no decoration. Density is
 * the design — every line earns its space. Inspired by rauno.me,
 * paco.me, leerob.com, and brittany chiang's understated work.
 *
 * Best for: senior engineers, design-conscious folks, and anyone
 * allergic to chrome.
 */

const FG = "#ededed";
const FG_DIM = "#a3a3a3";
const FG_FAINT = "#525252";
const FG_GHOST = "#2a2a2a";
const ACCENT = "#fafafa";
const HOVER = "#ffffff";

export default function MinimalTemplate() {
  const r = useResume();
  const handle = useHandle();
  const hidden = new Set(r.sections.hidden);
  const socials = allSocials(r);

  return (
    <div
      className="min-h-dvh font-mono antialiased selection:bg-neutral-700 selection:text-white"
      style={{
        background: "#0a0a0a",
        color: FG_DIM,
        fontSize: "13.5px",
        lineHeight: "1.7",
      }}
    >
      <div className="mx-auto max-w-[640px] px-5 sm:px-6 py-16 sm:py-24">
        <Header r={r} handle={handle} />

        {/* About */}
        {!hidden.has("about") && (
          <Section label="About" delay={1}>
            <Prose>{r.person.summary}</Prose>
          </Section>
        )}

        {/* Now strip — what they're doing right now */}
        {!hidden.has("work") && r.work[0] && (
          <Section label="Now" delay={2}>
            <NowLine work={r.work[0]} />
          </Section>
        )}

        {/* Work */}
        {!hidden.has("work") && r.work.length > 0 && (
          <Section label={`Work (${r.work.length})`} delay={3}>
            <Tabular>
              {r.work.map((w) => (
                <TabularRow
                  key={w.id}
                  href={w.href}
                  primary={
                    <>
                      <span style={{ color: ACCENT }}>{w.company}</span>
                      <span style={{ color: FG_DIM }}> — {w.title}</span>
                    </>
                  }
                  secondary={compactRange(w.start, w.end)}
                />
              ))}
            </Tabular>
          </Section>
        )}

        {/* Education */}
        {!hidden.has("education") && r.education.length > 0 && (
          <Section label={`Education (${r.education.length})`} delay={4}>
            <Tabular>
              {r.education.map((e) => (
                <TabularRow
                  key={e.id}
                  href={e.href}
                  primary={
                    <>
                      <span style={{ color: ACCENT }}>{e.school}</span>
                      <span style={{ color: FG_DIM }}> — {e.degree}</span>
                    </>
                  }
                  secondary={compactRange(e.start, e.end)}
                />
              ))}
            </Tabular>
          </Section>
        )}

        {/* Projects */}
        {!hidden.has("projects") && r.projects.length > 0 && (
          <Section label={`Projects (${r.projects.length})`} delay={5}>
            <ul className="space-y-5">
              {r.projects.slice(0, 14).map((p) => (
                <li key={p.id}>
                  <a
                    href={p.href ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="group block"
                  >
                    <div className="flex items-baseline gap-2">
                      <span
                        style={{ color: ACCENT }}
                        className="font-medium group-hover:underline underline-offset-[3px] decoration-dotted"
                      >
                        {p.title}
                      </span>
                      {p.active && (
                        <span style={{ color: "#5eead4" }} className="text-[10.5px]">
                          ●
                        </span>
                      )}
                      <ArrowUpRight
                        aria-hidden
                        className="size-3 opacity-0 -translate-y-0.5 group-hover:opacity-100 group-hover:translate-y-0 transition-all"
                        style={{ color: ACCENT }}
                      />
                      <DottedFill />
                      <span
                        className="text-[12px] tabular-nums flex-none"
                        style={{ color: FG_FAINT }}
                      >
                        {p.dates}
                      </span>
                    </div>
                    <p
                      className="text-[13px] leading-snug mt-0.5"
                      style={{ color: FG_DIM }}
                    >
                      {stripMd(p.description).split("\n")[0]}
                    </p>
                    {p.technologies.length > 0 && (
                      <div className="text-[11.5px] mt-1" style={{ color: FG_FAINT }}>
                        {p.technologies.slice(0, 6).join(", ")}
                      </div>
                    )}
                  </a>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Skills as a flowing paragraph */}
        {!hidden.has("skills") && r.skills.length > 0 && (
          <Section label={`Skills (${r.skills.length})`} delay={6}>
            <p className="leading-[1.85]">
              {r.skills.map((s, i) => (
                <span key={s.name}>
                  <span style={{ color: FG }}>{s.name}</span>
                  {i < r.skills.length - 1 && (
                    <span style={{ color: FG_GHOST }}>, </span>
                  )}
                </span>
              ))}
              <span style={{ color: FG_FAINT }}>.</span>
            </p>
          </Section>
        )}

        {/* Hackathons */}
        {!hidden.has("hackathons") && r.hackathons.length > 0 && (
          <Section label={`Hackathons (${r.hackathons.length})`} delay={7}>
            <Tabular>
              {r.hackathons.map((h) => (
                <TabularRow
                  key={h.id}
                  primary={
                    <>
                      <span style={{ color: ACCENT }}>{h.title}</span>
                      {h.rank && (
                        <span style={{ color: FG_DIM }}> — {h.rank}</span>
                      )}
                    </>
                  }
                  secondary={h.date ?? ""}
                />
              ))}
            </Tabular>
          </Section>
        )}

        {/* Publications */}
        {!hidden.has("publications") && r.publications.length > 0 && (
          <Section label={`Writing (${r.publications.length})`} delay={8}>
            <Tabular>
              {r.publications.map((p) => (
                <TabularRow
                  key={p.id}
                  href={p.url}
                  primary={
                    <>
                      <span style={{ color: ACCENT }}>{p.title}</span>
                      {p.venue && (
                        <span style={{ color: FG_DIM }}> · {p.venue}</span>
                      )}
                    </>
                  }
                  secondary={p.publishedAt ?? p.kind}
                />
              ))}
            </Tabular>
          </Section>
        )}

        {/* Build log — recent activity */}
        {!hidden.has("buildLog") && r.buildLog.length > 0 && (
          <Section label="Recently" delay={9}>
            <Tabular>
              {r.buildLog.slice(0, 10).map((b) => (
                <TabularRow
                  key={b.id}
                  primary={
                    <>
                      <span style={{ color: ACCENT }}>{b.title}</span>
                      <span style={{ color: FG_DIM }}> — {b.description}</span>
                    </>
                  }
                  secondary={b.dates}
                />
              ))}
            </Tabular>
          </Section>
        )}

        {/* Contact — keyed list */}
        {!hidden.has("contact") && (
          <Section label="Elsewhere" delay={10} last>
            <div className="space-y-1.5">
              {r.contact.email && (
                <ContactRow
                  label="email"
                  value={r.contact.email}
                  href={`mailto:${r.contact.email}`}
                />
              )}
              {socials.map((s) => (
                <ContactRow
                  key={s.url}
                  label={s.name.toLowerCase()}
                  value={prettyUrl(s.url)}
                  href={s.url}
                />
              ))}
            </div>
          </Section>
        )}

        <Footer name={r.person.name} updatedAt={r.meta.updatedAt} />
      </div>
    </div>
  );
}

/* ─────────────────────────  Components  ────────────────────────── */

function Header({
  r,
  handle,
}: {
  r: ReturnType<typeof useResume>;
  handle: string;
}) {
  return (
    <motion.header
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="mb-16"
    >
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <h1
          className="text-[15px] font-medium tracking-tight"
          style={{ color: ACCENT }}
        >
          {r.person.name}
        </h1>
        <span className="text-[11.5px]" style={{ color: FG_FAINT }}>
          @{handle}
        </span>
      </div>
      <p className="max-w-[42ch] leading-[1.7]" style={{ color: FG_DIM }}>
        {r.person.description}
      </p>
      {r.person.location && (
        <p
          className="mt-3 text-[12px] inline-flex items-center gap-2"
          style={{ color: FG_FAINT }}
        >
          <span aria-hidden className="size-1 rounded-full bg-[#5eead4]" />
          {r.person.location}
        </p>
      )}
    </motion.header>
  );
}

function Section({
  label,
  children,
  delay = 0,
  last = false,
}: {
  label: string;
  children: React.ReactNode;
  delay?: number;
  last?: boolean;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-30px" }}
      transition={{ duration: 0.4, delay: delay * 0.04, ease: "easeOut" }}
      className={last ? "" : "mb-12"}
    >
      <div
        className="text-[10.5px] uppercase tracking-[0.2em] mb-3 flex items-baseline gap-3"
        style={{ color: FG_FAINT }}
      >
        <span>{label}</span>
        <span
          className="flex-1 border-t"
          aria-hidden
          style={{ borderColor: FG_GHOST }}
        />
      </div>
      {children}
    </motion.section>
  );
}

function Prose({ children }: { children: string }) {
  return (
    <article
      className="max-w-prose [&_p]:mb-3 [&_p:last-child]:mb-0"
      style={{ color: FG_DIM }}
    >
      <Markdown
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              style={{ color: ACCENT }}
              className="underline underline-offset-[3px] decoration-dotted hover:decoration-solid transition-all"
            >
              {children}
            </a>
          ),
          strong: ({ children }) => (
            <strong style={{ color: ACCENT, fontWeight: 500 }}>{children}</strong>
          ),
          em: ({ children }) => (
            <em style={{ color: FG, fontStyle: "italic" }}>{children}</em>
          ),
          code: ({ children }) => (
            <code
              style={{
                color: FG,
                background: FG_GHOST,
                padding: "0.05em 0.35em",
                borderRadius: "3px",
                fontSize: "0.92em",
              }}
            >
              {children}
            </code>
          ),
        }}
      >
        {children}
      </Markdown>
    </article>
  );
}

function NowLine({
  work,
}: {
  work: ReturnType<typeof useResume>["work"][number];
}) {
  return (
    <p>
      <span style={{ color: FG_DIM }}>I'm </span>
      <span style={{ color: ACCENT }}>{work.title.toLowerCase()}</span>
      <span style={{ color: FG_DIM }}> at </span>
      {work.href ? (
        <a
          href={work.href}
          target="_blank"
          rel="noreferrer"
          style={{ color: ACCENT }}
          className="underline underline-offset-[3px] decoration-dotted hover:decoration-solid"
        >
          {work.company}
        </a>
      ) : (
        <span style={{ color: ACCENT }}>{work.company}</span>
      )}
      <span style={{ color: FG_DIM }}>, since </span>
      <span style={{ color: FG }} className="tabular-nums">
        {work.start}
      </span>
      <span style={{ color: FG_DIM }}>.</span>
    </p>
  );
}

function Tabular({ children }: { children: React.ReactNode }) {
  return <ul className="space-y-1">{children}</ul>;
}

function TabularRow({
  primary,
  secondary,
  href,
}: {
  primary: React.ReactNode;
  secondary: string;
  href?: string;
}) {
  const Wrapper = href
    ? ({ children }: { children: React.ReactNode }) => (
        <a
          href={href}
          target={href.startsWith("http") || href.startsWith("//") ? "_blank" : undefined}
          rel="noreferrer"
          className="group block"
        >
          {children}
        </a>
      )
    : ({ children }: { children: React.ReactNode }) => <div>{children}</div>;
  return (
    <li>
      <Wrapper>
        <div className="flex items-baseline gap-2">
          <span
            className={
              href
                ? "min-w-0 truncate group-hover:underline underline-offset-[3px] decoration-dotted"
                : "min-w-0 truncate"
            }
          >
            {primary}
          </span>
          <DottedFill />
          {secondary && (
            <span
              className="text-[12px] tabular-nums flex-none"
              style={{ color: FG_FAINT }}
            >
              {secondary}
            </span>
          )}
        </div>
      </Wrapper>
    </li>
  );
}

function ContactRow({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href: string;
}) {
  return (
    <a
      href={href}
      target={href.startsWith("mailto:") ? undefined : "_blank"}
      rel="noreferrer"
      className="group flex items-baseline gap-2"
    >
      <span
        className="text-[12px] uppercase tracking-wide w-24 flex-none"
        style={{ color: FG_FAINT }}
      >
        {label}
      </span>
      <span
        className="truncate group-hover:underline underline-offset-[3px] decoration-dotted"
        style={{ color: ACCENT }}
      >
        {value}
      </span>
      <ArrowUpRight
        aria-hidden
        className="size-3 opacity-0 -translate-y-0.5 group-hover:opacity-100 group-hover:translate-y-0 transition-all flex-none"
        style={{ color: ACCENT }}
      />
    </a>
  );
}

/**
 * Decorative dotted leader between primary and secondary text in a
 * tabular row. Uses SVG dots for crisper rendering than CSS dots.
 */
function DottedFill() {
  return (
    <span
      aria-hidden
      className="flex-1 h-[1.2em] mx-1 self-end"
      style={{
        backgroundImage: `radial-gradient(circle at center, ${FG_GHOST} 1px, transparent 1.5px)`,
        backgroundRepeat: "repeat-x",
        backgroundPosition: "0 100%",
        backgroundSize: "6px 7px",
      }}
    />
  );
}

function Footer({
  name,
  updatedAt,
}: {
  name: string;
  updatedAt: string;
}) {
  const initials = name
    .split(" ")
    .map((w) => w[0]?.toUpperCase())
    .join("");
  return (
    <motion.footer
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay: 0.4 }}
      className="mt-16 pt-6 border-t text-[11.5px] flex items-baseline justify-between gap-3"
      style={{ borderColor: FG_GHOST, color: FG_FAINT }}
    >
      <span>
        — {initials}, {new Date().getFullYear()}
      </span>
      <span className="tabular-nums">last edit · {formatShort(updatedAt)}</span>
    </motion.footer>
  );
}

/* ─────────────────────────  Helpers  ────────────────────────── */

function compactRange(start: string, end: string): string {
  const s = shortYear(start);
  const e = shortYear(end);
  return s === e ? s : `${s}–${e}`;
}

function shortYear(s: string): string {
  if (/present/i.test(s)) return "now";
  const m = s.match(/(\d{4})/);
  if (!m) return s;
  return `'${m[1]!.slice(2)}`;
}

function stripMd(s: string): string {
  return s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*_`]/g, "");
}

function prettyUrl(u: string): string {
  try {
    const url = new URL(u);
    return (url.hostname + url.pathname).replace(/^www\./, "").replace(/\/$/, "");
  } catch {
    return u;
  }
}

function formatShort(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  } catch {
    return "";
  }
}
