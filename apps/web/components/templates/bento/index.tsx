/* eslint-disable @next/next/no-img-element */
"use client";

import { motion } from "motion/react";
import { useState } from "react";
import { useResume, useHandle } from "@/components/data-provider";
import { allSocials } from "@gitshow/shared/resume";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { resolveSkillIcon } from "@/components/skill-icons";
import { Icons } from "@/components/icons";
import { formatResumeDate, formatResumeDateRange } from "@/lib/format-date";
import {
  ArrowUpRight,
  Check,
  Copy,
  Github,
  Linkedin,
  Mail,
  Twitter,
  Youtube,
} from "lucide-react";

/**
 * Bento — designer-portfolio bento.
 *
 * Black background, restrained typography, real photos and project
 * mockups as the visual content. The hero is a big bold typographic
 * name (Wayne Harkwood reference). The avatar gets its own real-photo
 * card. The experience column shows full entries inline, not a
 * minified timeline. "FEATURED WORK" labels a project mockup grid,
 * skills become an icon row, socials become a 2x3 icon grid, and
 * a "Wanna get in touch?" card holds the primary email CTA with a
 * one-tap copy button.
 *
 * Best for: full-stack devs, product engineers, and designers who
 * care about visual rhythm.
 */
const STAGGER = 0.04;
const ACCENT = "#3b82f6"; // blue-500 — single accent, sparing use

export default function BentoTemplate() {
  const r = useResume();
  const handle = useHandle();
  const hidden = new Set(r.sections.hidden);
  const socials = allSocials(r);

  const showWork = !hidden.has("work") && r.work.length > 0;
  const showEdu = !hidden.has("education") && r.education.length > 0;
  const showHack = !hidden.has("hackathons") && r.hackathons.length > 0;
  const showPubs = !hidden.has("publications") && r.publications.length > 0;
  const showBuild = !hidden.has("buildLog") && r.buildLog.length > 0;
  const showProjects = !hidden.has("projects") && r.projects.length > 0;

  const projects = r.projects;
  const featuredProjects = projects.slice(0, 5);

  const extras = [
    showHack && { id: "hack" as const },
    showPubs && { id: "pubs" as const },
    showBuild && { id: "build" as const },
  ].filter(Boolean) as Array<{ id: "hack" | "pubs" | "build" }>;
  const extraSpanClass =
    extras.length === 1
      ? "col-span-12"
      : extras.length === 2
        ? "col-span-12 md:col-span-6"
        : "col-span-12 md:col-span-4";

  return (
    <div className="min-h-dvh bg-[#0a0a0a] text-neutral-100 antialiased selection:bg-blue-500/30">
      <Aurora />

      <TopBar handle={handle} />

      <div className="relative z-10 mx-auto max-w-[1280px] px-3 sm:px-5 pb-24">
        <div className="grid grid-cols-12 gap-3 auto-rows-[110px]">
          {/* Row 1 — hero name + avatar + experience column */}
          <Card
            className="col-span-12 md:col-span-7 row-span-3 p-7 sm:p-10 flex flex-col justify-between"
            delay={1}
          >
            <NameDisplay name={r.person.name} />
            <HeroFooter
              description={r.person.description}
              location={r.person.location}
            />
          </Card>

          <Card
            className="col-span-6 md:col-span-2 row-span-3 p-0 overflow-hidden"
            delay={2}
          >
            <AvatarCard r={r} />
          </Card>

          {showWork && (
            <Card
              className="col-span-6 md:col-span-3 row-span-5 p-6 sm:p-7 flex flex-col"
              delay={3}
            >
              <ExperienceColumn work={r.work.slice(0, 3)} />
            </Card>
          )}

          {/* Row 2 — about + email CTA (experience continues from row 1) */}
          <Card
            className="col-span-12 md:col-span-5 row-span-2 p-6 sm:p-7"
            delay={4}
          >
            <AboutQuote summary={r.person.summary} firstName={r.person.name.split(" ")[0]} />
          </Card>

          <Card
            className="col-span-12 md:col-span-4 row-span-2 p-6 sm:p-7"
            delay={5}
          >
            <EmailCTA email={r.contact.email} />
          </Card>

          {/* Row 3 — Featured Work label + first 2 project mockups */}
          {showProjects && (
            <>
              <Card
                className="col-span-12 md:col-span-4 row-span-2 p-6 sm:p-7 flex flex-col justify-between"
                delay={6}
              >
                <FeaturedLabel count={featuredProjects.length} />
              </Card>
              {featuredProjects.slice(0, 2).map((p, i) => (
                <Card
                  key={p.id}
                  className="col-span-6 md:col-span-4 row-span-2 p-0 overflow-hidden group"
                  delay={7 + i}
                >
                  <ProjectImageCard project={p} />
                </Card>
              ))}

              {/* Row 4 — remaining featured projects (3-up grid) */}
              {featuredProjects.slice(2, 5).map((p, i) => (
                <Card
                  key={p.id}
                  className="col-span-6 md:col-span-4 row-span-2 p-0 overflow-hidden group"
                  delay={9 + i}
                >
                  <ProjectImageCard project={p} />
                </Card>
              ))}
            </>
          )}

          {/* Row 5 — skills + socials */}
          {r.skills.length > 0 && (
            <Card
              className="col-span-12 md:col-span-7 row-span-2 p-6 sm:p-7"
              delay={12}
            >
              <SkillsRow skills={r.skills} />
            </Card>
          )}
          {socials.length > 0 && (
            <Card
              className="col-span-12 md:col-span-5 row-span-2 p-6 sm:p-7"
              delay={13}
            >
              <SocialsGrid socials={socials} email={r.contact.email} />
            </Card>
          )}

          {/* Row 6 — education + extras */}
          {showEdu && (
            <Card
              className={
                extras.length > 0
                  ? "col-span-12 md:col-span-5 row-span-2 p-6 sm:p-7"
                  : "col-span-12 row-span-2 p-6 sm:p-7"
              }
              delay={14}
            >
              <EducationList education={r.education.slice(0, 3)} />
            </Card>
          )}

          {extras.map((ex, i) => {
            const cls =
              showEdu && extras.length > 0
                ? extras.length === 1
                  ? "col-span-12 md:col-span-7 row-span-2 p-6 sm:p-7"
                  : extras.length === 2
                    ? "col-span-12 md:col-span-7 row-span-2 p-6 sm:p-7"
                    : `${extraSpanClass} row-span-2 p-6 sm:p-7`
                : `${extraSpanClass} row-span-2 p-6 sm:p-7`;
            return (
              <Card key={ex.id} className={cls} delay={15 + i}>
                {ex.id === "hack" && <HackathonsList hackathons={r.hackathons} />}
                {ex.id === "pubs" && <PublicationsList publications={r.publications} />}
                {ex.id === "build" && <BuildLogList buildLog={r.buildLog} />}
              </Card>
            );
          })}

          {/* Row 7 — final contact band */}
          <Card
            className="col-span-12 row-span-2 p-7 sm:p-10 overflow-hidden relative"
            delay={20}
            tone="hero"
          >
            <ContactBand
              email={r.contact.email}
              socials={socials}
              name={r.person.name}
            />
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────  Card primitive  ────────────────────────── */

type Tone = "default" | "hero";

function Card({
  children,
  className = "",
  delay = 0,
  tone = "default",
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  tone?: Tone;
}) {
  const heroTone =
    tone === "hero"
      ? "bg-[radial-gradient(ellipse_at_top_left,rgba(59,130,246,0.10),transparent_60%),radial-gradient(ellipse_at_bottom_right,rgba(14,165,233,0.06),transparent_60%)]"
      : "bg-[#101010]";
  return (
    <motion.div
      initial={{ opacity: 0, y: 6, filter: "blur(4px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{ delay: delay * STAGGER, duration: 0.5, ease: "easeOut" }}
      className={`relative rounded-3xl border border-white/[0.06] ${heroTone} overflow-hidden hover:border-white/[0.10] transition-colors ${className}`}
      style={{
        boxShadow: "inset 0 1px 0 0 rgba(255,255,255,0.025)",
      }}
    >
      <div className="relative h-full w-full">{children}</div>
    </motion.div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-semibold tracking-[0.22em] uppercase text-neutral-400">
      {children}
    </div>
  );
}

/* ─────────────────────────  Background  ────────────────────────── */

function Aurora() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div
        className="absolute inset-x-0 top-0 h-[600px]"
        style={{
          background:
            "radial-gradient(ellipse 800px 400px at 30% 0%, rgba(59,130,246,0.10), transparent 60%), radial-gradient(ellipse 600px 300px at 75% 0%, rgba(14,165,233,0.06), transparent 60%)",
        }}
      />
      <div
        className="absolute inset-0 opacity-50"
        style={{
          background:
            "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.020) 1px, transparent 0)",
          backgroundSize: "32px 32px",
        }}
      />
    </div>
  );
}

/* ─────────────────────────  Top bar  ────────────────────────── */

function TopBar({ handle }: { handle: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="relative z-10 mx-auto max-w-[1280px] px-3 sm:px-5 py-5 sm:py-7"
    >
      <div className="flex items-center justify-between rounded-3xl border border-white/[0.06] bg-[#101010] px-5 sm:px-7 h-14">
        <span className="text-[14px] font-semibold tracking-wide flex items-center gap-2.5">
          <span
            aria-hidden
            className="size-2 rounded-full"
            style={{
              background: ACCENT,
              boxShadow: `0 0 10px ${ACCENT}`,
            }}
          />
          <span className="font-mono text-neutral-300">@{handle}</span>
        </span>
        <nav className="flex items-center gap-1 sm:gap-1.5 text-[12.5px] font-medium tracking-wider uppercase text-neutral-300">
          <a
            href="#about"
            className="px-2.5 sm:px-3 py-1.5 rounded-full hover:bg-white/[0.06] transition-colors"
          >
            About
          </a>
          <a
            href="#work"
            className="px-2.5 sm:px-3 py-1.5 rounded-full hover:bg-white/[0.06] transition-colors"
          >
            Work
          </a>
          <a
            href="#contact"
            className="px-2.5 sm:px-3 py-1.5 rounded-full hover:bg-white/[0.06] transition-colors"
          >
            Contact
          </a>
        </nav>
      </div>
    </motion.div>
  );
}

/* ─────────────────────────  Name display (hero)  ────────────────────────── */

function NameDisplay({ name }: { name: string }) {
  const tokens = name.split(" ");
  return (
    <div>
      <Eyebrow>Portfolio · {new Date().getFullYear()}</Eyebrow>
      <h1
        className="font-bold tracking-[-0.04em] text-white leading-[0.95] mt-5"
        style={{ fontSize: "clamp(48px, 7.5vw, 96px)" }}
      >
        {tokens.map((t, i) => (
          <span key={i} className="block">
            {t.toUpperCase()}
          </span>
        ))}
      </h1>
    </div>
  );
}

function HeroFooter({
  description,
  location,
}: {
  description: string;
  location?: string;
}) {
  return (
    <div className="mt-8 flex flex-wrap items-end justify-between gap-3">
      <p className="text-[14.5px] text-neutral-400 max-w-[44ch] leading-snug">
        {description}
      </p>
      <div className="flex items-center gap-3 text-[12px] font-mono text-neutral-500">
        {location && (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden>📍</span>
            {location}
          </span>
        )}
        <span className="inline-flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Available
        </span>
      </div>
    </div>
  );
}

/* ─────────────────────────  Avatar card  ────────────────────────── */

function AvatarCard({ r }: { r: ReturnType<typeof useResume> }) {
  if (!r.person.avatarUrl) {
    return (
      <div className="flex items-center justify-center w-full h-full bg-[radial-gradient(ellipse_at_center,rgba(59,130,246,0.16),transparent_70%)]">
        <Avatar className="size-32 ring-1 ring-white/10">
          <AvatarFallback className="text-3xl font-semibold">{r.person.initials}</AvatarFallback>
        </Avatar>
      </div>
    );
  }
  return (
    <div className="relative w-full h-full">
      <img
        src={r.person.avatarUrl}
        alt={r.person.name}
        className="absolute inset-0 w-full h-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent" />
    </div>
  );
}

/* ─────────────────────────  Experience column  ────────────────────────── */

function ExperienceColumn({
  work,
}: {
  work: ReturnType<typeof useResume>["work"];
}) {
  return (
    <>
      <h2 className="text-[28px] sm:text-[32px] font-bold tracking-tight text-white mb-1">
        Experience
      </h2>
      <div className="h-px bg-white/[0.08] mb-5" aria-hidden />
      <ol className="space-y-5 flex-1 overflow-hidden">
        {work.map((w, i) => (
          <li key={w.id} className={i > 0 ? "pt-5 border-t border-white/[0.06]" : ""}>
            <h3 className="text-[15px] font-semibold text-white leading-tight">
              {w.title}
            </h3>
            <div className="text-[13px] text-neutral-400 italic mt-0.5">
              {w.company}
              {w.location && (
                <>
                  <span className="text-neutral-600"> – </span>
                  <span>{w.location}</span>
                </>
              )}
            </div>
            <div className="text-[11.5px] font-mono text-neutral-500 mt-1 tabular-nums">
              {formatResumeDateRange(w.start, w.end)}
            </div>
            {w.description && (
              <p className="mt-2 text-[12.5px] leading-[1.6] text-neutral-400 line-clamp-4">
                {stripMd(w.description).split("\n")[0]}
              </p>
            )}
          </li>
        ))}
      </ol>
    </>
  );
}

/* ─────────────────────────  About quote  ────────────────────────── */

function AboutQuote({
  summary,
  firstName,
}: {
  summary: string;
  firstName?: string;
}) {
  // First "real" paragraph from summary, stripped of markdown noise.
  const firstPara = stripMd(summary).split("\n\n")[0]?.trim() ?? "";
  return (
    <div id="about" className="h-full flex flex-col">
      <p className="text-[15.5px] sm:text-[16px] leading-[1.6] text-neutral-300">
        Hey, I'm <span className="text-white font-medium">{firstName ?? "I"}</span>.{" "}
        {firstPara}
      </p>
      <div className="mt-auto pt-4 flex items-baseline justify-between">
        <Eyebrow>About</Eyebrow>
        <span className="text-[11px] font-mono text-neutral-500">scroll for more ↓</span>
      </div>
    </div>
  );
}

/* ─────────────────────────  Email CTA  ────────────────────────── */

function EmailCTA({ email }: { email?: string }) {
  if (!email) {
    return (
      <div className="h-full flex flex-col justify-between">
        <div className="text-[26px] sm:text-[32px] font-semibold leading-tight tracking-tight text-white">
          Wanna get
          <br />
          in touch?
        </div>
        <Eyebrow>Contact via socials</Eyebrow>
      </div>
    );
  }
  return (
    <a
      id="contact"
      href={`mailto:${email}`}
      className="group h-full flex flex-col justify-between cursor-pointer"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="text-[26px] sm:text-[32px] font-semibold leading-[1.05] tracking-tight text-white">
          Wanna get
          <br />
          in touch?
        </div>
        <ArrowUpRight
          aria-hidden
          className="size-7 text-neutral-500 transition-all duration-300 group-hover:rotate-12 group-hover:text-white -mr-1"
        />
      </div>
      <div className="text-[28px] sm:text-[36px] font-bold tracking-[-0.02em] uppercase mt-auto">
        Email me
      </div>
    </a>
  );
}

/* ─────────────────────────  Featured label  ────────────────────────── */

function FeaturedLabel({ count }: { count: number }) {
  return (
    <div id="work" className="h-full flex flex-col justify-between">
      <Eyebrow>{count} selected</Eyebrow>
      <h2
        className="font-bold italic tracking-[-0.02em] text-white leading-[0.95]"
        style={{ fontSize: "clamp(34px, 4.5vw, 56px)" }}
      >
        Featured
        <br />
        Work
      </h2>
      <div className="text-[12.5px] text-neutral-500 leading-snug max-w-[28ch]">
        A curated selection of recent projects. Click any card to dive in.
      </div>
    </div>
  );
}

/* ─────────────────────────  Project image card  ────────────────────────── */

function ProjectImageCard({
  project,
}: {
  project: ReturnType<typeof useResume>["projects"][number];
}) {
  return (
    <a
      href={project.href ?? "#"}
      target="_blank"
      rel="noreferrer"
      className="block w-full h-full relative bg-neutral-900"
    >
      {project.video ? (
        <video
          src={project.video}
          muted
          loop
          playsInline
          autoPlay
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
        />
      ) : project.image ? (
        <img
          src={project.image}
          alt={project.title}
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
        />
      ) : (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{
            background:
              "linear-gradient(135deg, rgba(30,64,175,0.4), rgba(8,12,20,1))",
          }}
        >
          <span className="font-bold text-2xl text-white/30">
            {project.title.slice(0, 2).toUpperCase()}
          </span>
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent opacity-90" />
      <div className="absolute bottom-0 left-0 right-0 p-5">
        <div className="text-[10.5px] font-mono uppercase tracking-[0.2em] text-neutral-300 mb-1">
          {project.dates}
          {project.active && (
            <span className="ml-2 text-emerald-400 inline-flex items-center gap-1">
              <span
                aria-hidden
                className="size-1 rounded-full bg-emerald-400 animate-pulse"
              />
              live
            </span>
          )}
        </div>
        <h3 className="font-semibold text-white text-[18px] leading-tight inline-flex items-baseline gap-2">
          {project.title}
          <ArrowUpRight
            aria-hidden
            className="size-4 opacity-70 transition-transform group-hover:rotate-12"
          />
        </h3>
        {project.technologies.length > 0 && (
          <div className="text-[11px] font-mono text-neutral-400 mt-1.5 truncate">
            {project.technologies.slice(0, 4).join(" · ")}
          </div>
        )}
      </div>
    </a>
  );
}

/* ─────────────────────────  Skills row  ────────────────────────── */

function SkillsRow({
  skills,
}: {
  skills: ReturnType<typeof useResume>["skills"];
}) {
  return (
    <>
      <Eyebrow>Stack</Eyebrow>
      <div className="mt-4 flex flex-wrap gap-2">
        {skills.map((s) => {
          const Icon = resolveSkillIcon(s.iconKey ?? s.name);
          return (
            <span
              key={s.name}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.06] text-[12.5px] text-neutral-200 hover:bg-white/[0.07] hover:border-white/[0.12] transition-all"
              title={
                s.usageCount
                  ? `Used in ${s.usageCount} repo${s.usageCount === 1 ? "" : "s"}`
                  : undefined
              }
            >
              {Icon && <Icon className="size-3.5" />}
              {s.name}
            </span>
          );
        })}
      </div>
    </>
  );
}

/* ─────────────────────────  Socials grid  ────────────────────────── */

function SocialsGrid({
  socials,
  email,
}: {
  socials: ReturnType<typeof allSocials>;
  email?: string;
}) {
  // Compose icon list from socials + email.
  const items: Array<{
    key: string;
    href: string;
    label: string;
    Icon: React.ComponentType<{ className?: string }>;
  }> = [];
  for (const s of socials) {
    items.push({
      key: s.url,
      href: s.url,
      label: s.name,
      Icon: socialIcon(s.name),
    });
  }
  if (email) {
    items.push({ key: "email", href: `mailto:${email}`, label: "Email", Icon: Mail });
  }
  return (
    <div className="h-full flex flex-col">
      <Eyebrow>Elsewhere</Eyebrow>
      <div className="mt-4 grid grid-cols-3 gap-2 flex-1 content-start">
        {items.slice(0, 6).map(({ key, href, label, Icon }) => (
          <a
            key={key}
            href={href}
            target={href.startsWith("mailto:") ? undefined : "_blank"}
            rel="noreferrer"
            aria-label={label}
            className="aspect-square flex items-center justify-center rounded-2xl bg-white/[0.04] border border-white/[0.06] text-neutral-300 hover:bg-white/[0.08] hover:border-white/[0.12] hover:text-white hover:-translate-y-px transition-all"
          >
            <Icon className="size-5" />
          </a>
        ))}
      </div>
    </div>
  );
}

function socialIcon(name: string): React.ComponentType<{ className?: string }> {
  const n = name.toLowerCase();
  if (n.includes("github")) return Github;
  if (n.includes("linkedin")) return Linkedin;
  if (n.includes("twitter") || n === "x") return Twitter;
  if (n.includes("youtube")) return Youtube;
  // Fall through to project icon registry for the rest.
  const Specific = (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[n];
  return Specific ?? ArrowUpRight;
}

/* ─────────────────────────  Education + extras  ────────────────────────── */

function EducationList({
  education,
}: {
  education: ReturnType<typeof useResume>["education"];
}) {
  return (
    <>
      <Eyebrow>Education</Eyebrow>
      <ul className="mt-4 space-y-4">
        {education.map((e) => (
          <li key={e.id}>
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
              <h3 className="text-[14.5px] font-semibold text-white leading-tight">
                {e.school}
              </h3>
              <div className="text-[11px] font-mono text-neutral-500 tabular-nums">
                {formatResumeDateRange(e.start, e.end)}
              </div>
            </div>
            <div className="text-[13px] text-neutral-400 italic mt-0.5">{e.degree}</div>
          </li>
        ))}
      </ul>
    </>
  );
}

function HackathonsList({
  hackathons,
}: {
  hackathons: ReturnType<typeof useResume>["hackathons"];
}) {
  return (
    <>
      <Eyebrow>Hackathons</Eyebrow>
      <ul className="mt-4 space-y-3 text-[13px]">
        {hackathons.slice(0, 4).map((h) => (
          <li
            key={h.id}
            className="border-l-2 pl-3"
            style={{ borderColor: `${ACCENT}66` }}
          >
            <div className="font-medium text-white truncate">{h.title}</div>
            {h.rank && (
              <div className="text-[11.5px]" style={{ color: ACCENT }}>
                ★ {h.rank}
              </div>
            )}
            {h.date && (
              <div className="text-[11px] text-neutral-500 tabular-nums font-mono">
                {h.date}
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

function PublicationsList({
  publications,
}: {
  publications: ReturnType<typeof useResume>["publications"];
}) {
  return (
    <>
      <Eyebrow>Publications</Eyebrow>
      <ul className="mt-4 space-y-3 text-[13px]">
        {publications.slice(0, 4).map((p) => (
          <li key={p.id}>
            <a
              href={p.url}
              target="_blank"
              rel="noreferrer"
              className="text-neutral-100 hover:text-white inline-flex items-baseline gap-1 group"
            >
              <span className="line-clamp-2">{p.title}</span>
              <ArrowUpRight
                className="size-3 opacity-0 group-hover:opacity-100 transition-opacity flex-none"
                style={{ color: ACCENT }}
              />
            </a>
            <div className="text-[11px] text-neutral-500 italic truncate">
              {p.venue}
              {p.publishedAt && ` · ${formatResumeDate(p.publishedAt)}`}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function BuildLogList({
  buildLog,
}: {
  buildLog: ReturnType<typeof useResume>["buildLog"];
}) {
  return (
    <>
      <Eyebrow>Recently shipping</Eyebrow>
      <ol className="mt-4 space-y-2.5 text-[12.5px]">
        {buildLog.slice(0, 6).map((b) => (
          <li key={b.id} className="flex items-baseline gap-2 leading-snug">
            <span
              aria-hidden
              className="size-1.5 rounded-full flex-none translate-y-1"
              style={{ backgroundColor: b.languageColor ?? ACCENT }}
            />
            <div className="flex-1 min-w-0">
              <div className="text-neutral-100 truncate">
                <span className="font-medium">{b.title}</span>
                <span className="text-neutral-500"> — {b.description}</span>
              </div>
              <div className="text-[10.5px] text-neutral-600 tabular-nums font-mono">
                {b.dates}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}

/* ─────────────────────────  Contact band  ────────────────────────── */

function ContactBand({
  email,
  socials,
  name,
}: {
  email?: string;
  socials: ReturnType<typeof allSocials>;
  name: string;
}) {
  const firstName = name.split(" ")[0] ?? name;
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    if (!email) return;
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Best-effort; fall through silently.
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-5 h-full">
      <div className="min-w-0">
        <Eyebrow>Get in touch</Eyebrow>
        <h2
          className="font-semibold tracking-[-0.02em] text-white leading-[1.05] mt-2"
          style={{ fontSize: "clamp(24px, 3.5vw, 36px)" }}
        >
          Have a project in mind, {firstName}-style?
        </h2>
        <p className="mt-2 text-neutral-400 text-[14px] max-w-[44ch]">
          I'm reachable, and I read every email. Reply within a couple of days.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {email && (
          <button
            type="button"
            onClick={onCopy}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-white text-black text-[13px] font-semibold hover:-translate-y-px transition-all shadow-[0_8px_24px_-8px_rgba(96,165,250,0.4)]"
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? "Copied" : email}
          </button>
        )}
        {socials.slice(0, 3).map((s) => (
          <a
            key={s.url}
            href={s.url}
            target="_blank"
            rel="noreferrer"
            className="px-4 py-2.5 rounded-full bg-white/[0.06] border border-white/[0.06] text-[13px] hover:bg-white/[0.10] hover:border-white/[0.12] hover:-translate-y-px transition-all"
          >
            {s.name}
          </a>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────  Helpers  ────────────────────────── */

function stripMd(s: string): string {
  return s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*_`#>]/g, "");
}
