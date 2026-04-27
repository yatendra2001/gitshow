/* eslint-disable @next/next/no-img-element */
"use client";

import Markdown from "react-markdown";
import { motion } from "motion/react";
import { useResume, useHandle } from "@/components/data-provider";
import { allSocials } from "@gitshow/shared/resume";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ArrowUpRight, ArrowRight } from "lucide-react";

/**
 * Brutalist — a manifesto of work.
 *
 * Massive type as the primary design element. Strict 12-column grid
 * intentionally violated. Tabular dates, monochrome with one red
 * accent, no rounded corners, heavy borders, oversized numbers.
 * Reads like a Pentagram or Praxis studio site.
 *
 * Best for: designers and creative engineers who'd rather be
 * remembered than liked.
 */
const ACCENT = "#ff3300";

export default function BrutalistTemplate() {
  const r = useResume();
  const handle = useHandle();
  const hidden = new Set(r.sections.hidden);
  const socials = allSocials(r);

  return (
    <div
      className="min-h-dvh bg-[#fafafa] text-black antialiased"
      style={{
        fontFeatureSettings: '"liga","dlig","kern","tnum"',
      }}
    >
      <Marquee name={r.person.name} handle={handle} location={r.person.location} />

      <div className="mx-auto max-w-[1400px] px-4 sm:px-8 pt-6 pb-32">
        <Hero person={r.person} />

        <DividerThick />

        <Section num="01" title="THE PREMISE" subtitle="What this is, in one read.">
          <Lede summary={r.person.summary} />
        </Section>

        {!hidden.has("work") && r.work.length > 0 && (
          <>
            <DividerThick />
            <Section num="02" title="THE WORK" subtitle={`${r.work.length} engagements, in order.`}>
              <WorkTable work={r.work} />
            </Section>
          </>
        )}

        {r.skills.length > 0 && (
          <>
            <DividerThick />
            <Section
              num="03"
              title="THE STACK"
              subtitle={`${r.skills.length} tools, daily.`}
            >
              <SkillsRiver skills={r.skills} />
            </Section>
          </>
        )}

        {!hidden.has("projects") && r.projects.length > 0 && (
          <>
            <DividerThick />
            <Section
              num="04"
              title="THE OUTPUT"
              subtitle={`${r.projects.length} projects, the standout first.`}
            >
              <ProjectsGrid projects={r.projects.slice(0, 8)} />
            </Section>
          </>
        )}

        {!hidden.has("education") && r.education.length > 0 && (
          <>
            <DividerThick />
            <Section num="05" title="THE SCHOOLING">
              <EducationGrid education={r.education} />
            </Section>
          </>
        )}

        {!hidden.has("hackathons") && r.hackathons.length > 0 && (
          <>
            <DividerThick />
            <Section
              num="06"
              title="THE FIELDWORK"
              subtitle="Hackathons, jams, weekends spent shipping."
            >
              <HackathonsList hackathons={r.hackathons} />
            </Section>
          </>
        )}

        {!hidden.has("publications") && r.publications.length > 0 && (
          <>
            <DividerThick />
            <Section num="07" title="THE RECORD" subtitle="Talks, papers, recordings.">
              <PublicationsList publications={r.publications} />
            </Section>
          </>
        )}

        {!hidden.has("buildLog") && r.buildLog.length > 0 && (
          <>
            <DividerThick />
            <Section num="08" title="THE LOG" subtitle="Recent commits to the lifelong project.">
              <BuildLogList buildLog={r.buildLog.slice(0, 14)} />
            </Section>
          </>
        )}

        <DividerThick />

        <Contact email={r.contact.email} socials={socials} name={r.person.name} />

        <Endnote name={r.person.name} handle={handle} />
      </div>
    </div>
  );
}

/* ─────────────────────────  Components  ────────────────────────── */

function Marquee({
  name,
  handle,
  location,
}: {
  name: string;
  handle: string;
  location?: string;
}) {
  const items = [
    name,
    `@${handle}`,
    location ?? "Worldwide",
    "Available for select engagements",
    "↑↓",
    "/twentyfour",
  ];
  const repeated = Array.from({ length: 6 }).flatMap(() => items);
  return (
    <div className="border-b-[3px] border-black overflow-hidden bg-black text-[#fafafa]">
      <div className="flex whitespace-nowrap py-2.5 text-[11px] tracking-[0.4em] uppercase font-bold animate-[brutal-marquee_45s_linear_infinite]">
        {repeated.map((it, i) => (
          <span key={i} className="px-6 inline-flex items-center gap-6 flex-none">
            <span>{it}</span>
            <span aria-hidden className="text-[ACCENT]" style={{ color: ACCENT }}>
              ★
            </span>
          </span>
        ))}
      </div>
      <style>{`
        @keyframes brutal-marquee {
          from { transform: translateX(0); }
          to   { transform: translateX(-${100 / 6}%); }
        }
      `}</style>
    </div>
  );
}

function Hero({ person }: { person: ReturnType<typeof useResume>["person"] }) {
  const tokens = person.name.split(" ");
  return (
    <section className="grid grid-cols-12 gap-4 sm:gap-6 mt-12 mb-12">
      <div className="col-span-12 md:col-span-9">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="text-[11px] tracking-[0.45em] uppercase font-bold mb-4 inline-flex items-center gap-2"
        >
          <span aria-hidden style={{ background: ACCENT }} className="h-3 w-3" />
          A working portfolio · {new Date().getFullYear()}
        </motion.div>
        <h1
          className="font-bold leading-[0.82] tracking-[-0.04em]"
          style={{ fontSize: "clamp(64px, 14vw, 200px)" }}
        >
          {tokens.map((token, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{
                duration: 0.55,
                delay: 0.1 + i * 0.08,
                ease: [0.16, 1, 0.3, 1],
              }}
              className={`block ${i % 2 === 1 ? "italic" : ""}`}
              style={i % 2 === 1 ? { color: ACCENT } : undefined}
            >
              {token.toUpperCase()}
              {i === tokens.length - 1 && "."}
            </motion.div>
          ))}
        </h1>
      </div>

      <div className="col-span-12 md:col-span-3 flex flex-col justify-end gap-5">
        {person.avatarUrl && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, delay: 0.4, ease: "easeOut" }}
          >
            <Avatar className="size-32 sm:size-40 rounded-none border-[3px] border-black shadow-[8px_8px_0_0_#000]">
              <AvatarImage
                src={person.avatarUrl}
                alt={person.name}
                className="object-cover grayscale contrast-125"
              />
              <AvatarFallback
                className="rounded-none text-3xl font-bold text-white"
                style={{ background: ACCENT }}
              >
                {person.initials}
              </AvatarFallback>
            </Avatar>
          </motion.div>
        )}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.7 }}
          className="border-l-[6px] pl-3 py-1"
          style={{ borderColor: ACCENT }}
        >
          <div className="text-[10px] tracking-[0.3em] uppercase font-bold mb-1">
            The pitch
          </div>
          <p className="text-[15.5px] font-bold leading-snug">
            {person.description}
          </p>
        </motion.div>
      </div>
    </section>
  );
}

function DividerThick() {
  return <div className="my-12 sm:my-16 h-[3px] bg-black" />;
}

function Section({
  num,
  title,
  subtitle,
  children,
}: {
  num: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-100px" }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="my-12 sm:my-16"
    >
      <div className="grid grid-cols-12 gap-4 sm:gap-6 mb-10">
        <div className="col-span-12 md:col-span-2 flex flex-col gap-1">
          <div className="text-[11px] tracking-[0.4em] uppercase font-bold inline-flex items-center gap-2">
            <span style={{ background: ACCENT }} className="h-2 w-2" aria-hidden />
            §{num}
          </div>
        </div>
        <div className="col-span-12 md:col-span-10">
          <h2
            className="font-bold leading-[0.88] tracking-[-0.03em]"
            style={{ fontSize: "clamp(40px, 7vw, 96px)" }}
          >
            {title}
          </h2>
          {subtitle && (
            <p className="text-[14px] uppercase tracking-[0.15em] font-bold text-black/60 mt-3">
              {subtitle}
            </p>
          )}
        </div>
      </div>
      <div className="grid grid-cols-12 gap-4 sm:gap-6">{children}</div>
    </motion.section>
  );
}

function Lede({ summary }: { summary: string }) {
  return (
    <div className="col-span-12 md:col-span-8 md:col-start-3">
      <div
        className="text-[20px] sm:text-[24px] leading-[1.4] font-medium [&_p]:mb-5 [&_p:last-child]:mb-0 [&_strong]:font-bold [&_a]:underline [&_a]:decoration-[3px] [&_a]:underline-offset-[6px]"
        style={{ ["--tw-prose-links" as string]: ACCENT }}
      >
        <Markdown
          components={{
            a: ({ href, children }) => (
              <a
                href={href}
                style={{ textDecorationColor: ACCENT }}
                className="hover:bg-black hover:text-white transition-colors"
              >
                {children}
              </a>
            ),
          }}
        >
          {summary}
        </Markdown>
      </div>
    </div>
  );
}

function WorkTable({
  work,
}: {
  work: ReturnType<typeof useResume>["work"];
}) {
  return (
    <div className="col-span-12">
      {/* Header row */}
      <div className="hidden md:grid grid-cols-12 gap-4 border-b-[3px] border-black pb-2 mb-2 text-[11px] tracking-[0.3em] uppercase font-bold">
        <div className="col-span-1">#</div>
        <div className="col-span-3">Company</div>
        <div className="col-span-3">Role</div>
        <div className="col-span-2">Years</div>
        <div className="col-span-3 text-right">Detail</div>
      </div>
      <ol className="divide-y divide-black/15">
        {work.map((w, i) => (
          <li key={w.id} className="group">
            <details className="block">
              <summary className="cursor-pointer list-none grid grid-cols-12 gap-4 py-5 hover:bg-black hover:text-white transition-colors items-baseline px-1 -mx-1">
                <div className="col-span-1 text-3xl md:text-4xl font-bold tabular-nums leading-none">
                  {String(i + 1).padStart(2, "0")}
                </div>
                <div className="col-span-12 md:col-span-3 text-2xl md:text-3xl font-bold uppercase tracking-tight leading-[0.95]">
                  {w.company}
                </div>
                <div className="col-span-12 md:col-span-3 text-[15px] font-medium">
                  {w.title}
                </div>
                <div className="col-span-12 md:col-span-2 text-[13px] tabular-nums font-mono">
                  {w.start} – {w.end}
                </div>
                <div className="col-span-12 md:col-span-3 text-right inline-flex items-center justify-end gap-2 text-[12px] uppercase tracking-wider font-bold">
                  Read
                  <ArrowRight
                    aria-hidden
                    className="size-4 transition-transform group-hover:translate-x-1"
                  />
                </div>
              </summary>
              <div className="grid grid-cols-12 gap-4 py-6 px-1 bg-black text-[#fafafa]">
                <div className="col-span-12 md:col-span-2 md:col-start-2">
                  {w.location && (
                    <div className="text-[11px] uppercase tracking-[0.2em] font-bold mb-1 opacity-70">
                      Location
                    </div>
                  )}
                  {w.location && (
                    <div className="text-[14px] font-medium mb-4">{w.location}</div>
                  )}
                  {w.badges && w.badges.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {w.badges.map((b) => (
                        <span
                          key={b}
                          className="text-[10px] tracking-wide uppercase font-bold border border-white/40 px-2 py-0.5"
                        >
                          {b}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="col-span-12 md:col-span-9 prose prose-invert prose-lg max-w-none [&_p]:mb-3 [&_p:last-child]:mb-0">
                  <Markdown>{w.description}</Markdown>
                  {w.href && (
                    <a
                      href={w.href}
                      target="_blank"
                      rel="noreferrer"
                      className="not-prose inline-flex items-center gap-1 mt-4 text-[12px] uppercase tracking-wider font-bold underline underline-offset-4"
                      style={{ color: ACCENT }}
                    >
                      {new URL(w.href).hostname.replace("www.", "")}
                      <ArrowUpRight className="size-3" />
                    </a>
                  )}
                </div>
              </div>
            </details>
          </li>
        ))}
      </ol>
    </div>
  );
}

function SkillsRiver({
  skills,
}: {
  skills: ReturnType<typeof useResume>["skills"];
}) {
  return (
    <div className="col-span-12">
      <div
        className="font-bold leading-[1.15] tracking-[-0.02em] flex flex-wrap items-baseline gap-x-2"
        style={{ fontSize: "clamp(28px, 4vw, 56px)" }}
      >
        {skills.map((s, i) => (
          <span key={s.name} className="inline-flex items-baseline">
            <span
              className={i % 4 === 0 ? "italic" : ""}
              style={i % 4 === 0 ? { color: ACCENT } : undefined}
            >
              {s.name}
            </span>
            {i < skills.length - 1 && (
              <span className="text-black/30 mx-1.5 text-[0.6em]" aria-hidden>
                /
              </span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

function ProjectsGrid({
  projects,
}: {
  projects: ReturnType<typeof useResume>["projects"];
}) {
  return (
    <div className="col-span-12 grid grid-cols-12 gap-4 sm:gap-6">
      {projects.map((p, i) => {
        const span =
          i === 0
            ? "col-span-12 md:col-span-8 md:row-span-2"
            : i === 1
              ? "col-span-12 md:col-span-4"
              : i === 2
                ? "col-span-12 md:col-span-4"
                : "col-span-12 sm:col-span-6 md:col-span-4";
        return (
          <a
            key={p.id}
            href={p.href ?? "#"}
            target="_blank"
            rel="noreferrer"
            className={`group block ${span}`}
          >
            <article className="border-[3px] border-black bg-white h-full flex flex-col transition-transform duration-200 hover:-translate-x-1 hover:-translate-y-1 hover:shadow-[8px_8px_0_0_#000]">
              {(p.image || p.video) && (
                <div
                  className={`w-full overflow-hidden border-b-[3px] border-black bg-[#e8e6df] ${
                    i === 0 ? "aspect-[16/10]" : "aspect-[4/3]"
                  }`}
                >
                  {p.video ? (
                    <video
                      src={p.video}
                      muted
                      loop
                      playsInline
                      autoPlay
                      className="w-full h-full object-cover grayscale contrast-110 group-hover:grayscale-0 transition-all duration-700"
                    />
                  ) : (
                    <img
                      src={p.image}
                      alt={p.title}
                      className="w-full h-full object-cover grayscale contrast-110 group-hover:grayscale-0 transition-all duration-700"
                    />
                  )}
                </div>
              )}
              <div className="p-4 flex-1 flex flex-col">
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <div className="text-[11px] tracking-[0.25em] uppercase font-bold text-black/60 tabular-nums">
                    №{String(i + 1).padStart(2, "0")} · {p.dates}
                  </div>
                  {p.active && (
                    <span
                      className="text-[10px] uppercase tracking-wider font-bold text-white px-1.5"
                      style={{ background: ACCENT }}
                    >
                      Active
                    </span>
                  )}
                </div>
                <h3
                  className={`font-bold tracking-tight uppercase leading-[0.95] ${
                    i === 0 ? "text-3xl sm:text-5xl" : "text-xl"
                  }`}
                >
                  {p.title}
                </h3>
                {(i === 0 || i === 1) && p.description && (
                  <p className="mt-2 text-[14px] leading-snug font-medium line-clamp-3">
                    {stripMd(p.description)}
                  </p>
                )}
                {p.technologies.length > 0 && (
                  <div className="mt-auto pt-3 flex flex-wrap gap-1.5">
                    {p.technologies.slice(0, i === 0 ? 6 : 3).map((t) => (
                      <span
                        key={t}
                        className="text-[10px] tracking-wide uppercase font-bold border border-black px-1.5 py-0.5"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-3 inline-flex items-center gap-1 text-[11px] uppercase tracking-wider font-bold opacity-70 group-hover:opacity-100">
                  Open project
                  <ArrowUpRight className="size-3.5 transition-transform group-hover:rotate-12" />
                </div>
              </div>
            </article>
          </a>
        );
      })}
    </div>
  );
}

function EducationGrid({
  education,
}: {
  education: ReturnType<typeof useResume>["education"];
}) {
  return (
    <div className="col-span-12 grid grid-cols-12 gap-x-6 gap-y-8">
      {education.map((e, i) => (
        <div
          key={e.id}
          className="col-span-12 md:col-span-6 border-l-[6px] pl-4 py-1"
          style={{ borderColor: ACCENT }}
        >
          <div className="flex items-baseline justify-between gap-2 mb-1">
            <div className="text-[11px] tracking-[0.25em] uppercase font-bold tabular-nums">
              №{String(i + 1).padStart(2, "0")}
            </div>
            <div className="text-[11px] tracking-[0.25em] uppercase font-bold tabular-nums">
              {e.start} → {e.end}
            </div>
          </div>
          <div className="font-bold text-2xl leading-tight uppercase tracking-tight">
            {e.school}
          </div>
          <div className="text-base mt-1">{e.degree}</div>
        </div>
      ))}
    </div>
  );
}

function HackathonsList({
  hackathons,
}: {
  hackathons: ReturnType<typeof useResume>["hackathons"];
}) {
  return (
    <div className="col-span-12 grid grid-cols-12 gap-x-6 gap-y-6">
      {hackathons.map((h, i) => (
        <article
          key={h.id}
          className="col-span-12 md:col-span-6 lg:col-span-4 border-2 border-black p-4 hover:bg-black hover:text-white transition-colors"
        >
          <div className="flex items-baseline justify-between gap-2 text-[11px] tracking-[0.25em] uppercase font-bold mb-2">
            <span className="tabular-nums">№{String(i + 1).padStart(2, "0")}</span>
            {h.date && <span className="tabular-nums">{h.date}</span>}
          </div>
          <h3 className="font-bold text-xl leading-tight uppercase tracking-tight">{h.title}</h3>
          {h.rank && (
            <div
              className="mt-2 inline-block text-[11px] uppercase tracking-wider font-bold text-white px-2 py-0.5"
              style={{ background: ACCENT }}
            >
              ★ {h.rank}
            </div>
          )}
          {h.description && (
            <p className="text-[13.5px] mt-3 leading-snug">{h.description}</p>
          )}
          {h.location && (
            <div className="text-[11px] mt-2 opacity-70 italic">{h.location}</div>
          )}
        </article>
      ))}
    </div>
  );
}

function PublicationsList({
  publications,
}: {
  publications: ReturnType<typeof useResume>["publications"];
}) {
  return (
    <div className="col-span-12 space-y-1">
      {publications.map((p, i) => (
        <a
          key={p.id}
          href={p.url}
          target="_blank"
          rel="noreferrer"
          className="grid grid-cols-12 gap-4 items-baseline border-b-2 border-black py-4 hover:bg-black hover:text-white transition-colors group"
        >
          <div className="col-span-1 text-2xl font-bold tabular-nums leading-none">
            {String(i + 1).padStart(2, "0")}
          </div>
          <div className="col-span-12 md:col-span-2 text-[11px] tracking-[0.3em] uppercase font-bold">
            {p.kind}{p.publishedAt ? ` · ${p.publishedAt}` : ""}
          </div>
          <div className="col-span-12 md:col-span-7">
            <div className="font-bold text-xl leading-tight uppercase tracking-tight inline-flex items-baseline gap-2">
              {p.title}
              <ArrowUpRight className="size-4 transition-transform group-hover:rotate-12" />
            </div>
            {p.venue && (
              <div className="text-[13px] mt-1 italic opacity-80">{p.venue}</div>
            )}
          </div>
          <div className="col-span-12 md:col-span-2 md:text-right text-[11px] tracking-wider uppercase font-bold opacity-70">
            {p.coAuthors && p.coAuthors.length > 0
              ? `+${p.coAuthors.length} co-author${p.coAuthors.length === 1 ? "" : "s"}`
              : "Solo"}
          </div>
        </a>
      ))}
    </div>
  );
}

function BuildLogList({
  buildLog,
}: {
  buildLog: ReturnType<typeof useResume>["buildLog"];
}) {
  return (
    <div className="col-span-12">
      <ol className="font-mono text-[13.5px] divide-y divide-black/20">
        {buildLog.map((b, i) => (
          <li
            key={b.id}
            className="grid grid-cols-12 gap-3 items-baseline py-2.5 hover:bg-black hover:text-white transition-colors px-1 -mx-1"
          >
            <span className="col-span-1 tabular-nums text-black/50 group-hover:text-white/60">
              {String(i + 1).padStart(3, "0")}
            </span>
            <span className="col-span-3 md:col-span-2 tabular-nums font-bold uppercase tracking-wider text-[11px]">
              {b.dates}
            </span>
            <span
              aria-hidden
              className="size-2 col-span-1 md:col-span-1 flex-none"
              style={{ background: b.languageColor ?? ACCENT }}
            />
            <span className="col-span-12 md:col-span-3 font-bold uppercase tracking-tight truncate">
              {b.title}
            </span>
            <span className="col-span-12 md:col-span-5 truncate">{b.description}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Contact({
  email,
  socials,
  name,
}: {
  email?: string;
  socials: ReturnType<typeof allSocials>;
  name: string;
}) {
  const firstName = name.split(" ")[0] ?? name;
  return (
    <section className="my-16">
      <h2
        className="font-bold leading-[0.85] tracking-[-0.04em] uppercase mb-8"
        style={{ fontSize: "clamp(48px, 11vw, 160px)" }}
      >
        Get in
        <br />
        <span className="italic" style={{ color: ACCENT }}>
          touch.
        </span>
      </h2>
      <div className="grid grid-cols-12 gap-4">
        {email && (
          <a
            href={`mailto:${email}`}
            className="col-span-12 md:col-span-7 border-[3px] border-black bg-black text-white p-7 flex items-center justify-between gap-4 hover:text-white transition-colors group"
            style={{ ["--hover-bg" as string]: ACCENT }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLAnchorElement).style.background = ACCENT)
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLAnchorElement).style.background = "#000")
            }
          >
            <div>
              <div className="text-[11px] tracking-[0.3em] uppercase font-bold opacity-70 mb-2">
                Direct line
              </div>
              <span className="text-2xl sm:text-3xl font-bold break-all">{email}</span>
            </div>
            <ArrowUpRight className="size-7 flex-none transition-transform group-hover:rotate-12" />
          </a>
        )}
        <div className="col-span-12 md:col-span-5 grid grid-cols-2 gap-3">
          {socials.slice(0, 4).map((s) => (
            <a
              key={s.url}
              href={s.url}
              target="_blank"
              rel="noreferrer"
              className="border-[3px] border-black p-4 font-bold uppercase tracking-wider text-sm flex items-center justify-between hover:text-white transition-colors group"
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLAnchorElement).style.background = ACCENT)
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLAnchorElement).style.background = "transparent")
              }
            >
              <span>{s.name}</span>
              <ArrowUpRight className="size-4 transition-transform group-hover:rotate-12" />
            </a>
          ))}
        </div>
      </div>
      <p className="mt-8 text-[12px] uppercase tracking-[0.2em] font-bold text-black/60">
        Reply within {firstName === firstName.toLowerCase() ? "a few days" : "48 hours"}.
        Cold pitches welcome if specific.
      </p>
    </section>
  );
}

function Endnote({
  name,
  handle,
}: {
  name: string;
  handle: string;
}) {
  return (
    <footer className="mt-20 pt-4 border-t-[3px] border-black grid grid-cols-12 gap-4 text-[11px] tracking-[0.3em] uppercase font-bold">
      <div className="col-span-6 md:col-span-3">End of file</div>
      <div className="col-span-6 md:col-span-6 md:text-center text-black/60">
        Set in a heavy grotesque, weight 700, kerned by hand.
      </div>
      <div className="col-span-12 md:col-span-3 md:text-right">
        {name} · @{handle}
      </div>
    </footer>
  );
}

/* ─────────────────────────  Helpers  ────────────────────────── */

function stripMd(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
