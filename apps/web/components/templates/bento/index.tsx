/* eslint-disable @next/next/no-img-element */
"use client";

import Markdown from "react-markdown";
import { motion } from "motion/react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useResume, useHandle } from "@/components/data-provider";
import { allSocials } from "@gitshow/shared/resume";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { LogoOrInitials } from "@/components/logo-or-initials";
import { resolveSkillIcon } from "@/components/skill-icons";
import { ArrowUpRight, Sparkles } from "lucide-react";

/**
 * Bento — Apple/Vercel-style bento grid.
 *
 * Cards of intentionally varied size that tile together with no
 * leftover empty columns. Rows are composed dynamically based on what
 * data the user has — hackathons + publications + buildLog only render
 * when present, and the row layout adapts so we never have a 4-col card
 * sitting next to 8 empty columns.
 *
 * Best for: full-stack devs, product engineers, and visual thinkers.
 */
const STAGGER = 0.04;

export default function BentoTemplate() {
  const r = useResume();
  const handle = useHandle();
  const hidden = new Set(r.sections.hidden);
  const socials = allSocials(r);
  const projects = r.projects;
  const featured = projects[0];
  const sideProjects = projects.slice(1, 4);
  const stats = useMemo(
    () => computeStats(r),
    [r.skills.length, r.projects.length, r.work.length, r.buildLog.length, r.publications.length],
  );

  const showWork = !hidden.has("work") && r.work.length > 0;
  const showEdu = !hidden.has("education") && r.education.length > 0;
  const showHack = !hidden.has("hackathons") && r.hackathons.length > 0;
  const showPubs = !hidden.has("publications") && r.publications.length > 0;
  const showBuild = !hidden.has("buildLog") && r.buildLog.length > 0;

  // Dynamic row composition for "extras": fill 12 cols regardless of
  // how many of hackathons/publications/buildLog are present.
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
    <div className="min-h-dvh bg-[#070708] text-neutral-100 selection:bg-violet-400/30 antialiased">
      <Aurora />

      <div className="relative z-10 mx-auto max-w-[1400px] px-3 sm:px-6 py-6 sm:py-10">
        <TopBar handle={handle} socials={socials} />

        {/* Density goes up: smaller min row height, tighter gaps */}
        <div className="grid grid-cols-12 gap-3 auto-rows-[100px]">
          {/* Row 1: hero (8) + avatar/currently combo (4) */}
          <Card className="col-span-12 md:col-span-8 row-span-3 p-6 sm:p-9 flex flex-col justify-between" tone="bright" delay={1}>
            <Hero r={r} />
          </Card>

          <Card className="col-span-6 md:col-span-4 row-span-3 p-0 overflow-hidden" delay={2}>
            <AvatarCard r={r} />
          </Card>

          {/* Row 2: 4-up stat strip — always fills 12 */}
          {stats.map((s, i) => (
            <Card
              key={s.label}
              className="col-span-6 md:col-span-3 row-span-1 px-4 py-3 flex flex-col justify-between"
              delay={3 + i}
              tone={s.tone}
            >
              <StatCard {...s} />
            </Card>
          ))}

          {/* Row 3: about (7) + featured project (5) — fills 12 always.
               If no featured project, about expands to full width. */}
          {featured ? (
            <>
              <Card className="col-span-12 md:col-span-7 row-span-3 p-5 sm:p-6" delay={7}>
                <AboutCard summary={r.person.summary} />
              </Card>
              <Card className="col-span-12 md:col-span-5 row-span-3 p-0 overflow-hidden group" delay={8}>
                <FeaturedProjectCard project={featured} />
              </Card>
            </>
          ) : (
            <Card className="col-span-12 row-span-2 p-5 sm:p-6" delay={7}>
              <AboutCard summary={r.person.summary} />
            </Card>
          )}

          {/* Row 4: skills (7) + currently (5) OR skills (12) if no current work.
               Skills row count adapts to skill count. */}
          {r.skills.length > 0 && r.work[0] ? (
            <>
              <Card className="col-span-12 md:col-span-7 row-span-2 p-5" delay={9}>
                <SkillsCard skills={r.skills} />
              </Card>
              <Card className="col-span-12 md:col-span-5 row-span-2 p-5" delay={10} tone="bright">
                <CurrentlyCard work={r.work[0]} />
              </Card>
            </>
          ) : r.skills.length > 0 ? (
            <Card className="col-span-12 row-span-2 p-5" delay={9}>
              <SkillsCard skills={r.skills} />
            </Card>
          ) : r.work[0] ? (
            <Card className="col-span-12 row-span-1 p-5" delay={10} tone="bright">
              <CurrentlyCard work={r.work[0]} compact />
            </Card>
          ) : null}

          {/* Row 5: side projects — fills 12 by sizing dynamically */}
          {sideProjects.length > 0 && (() => {
            const sideSpanClass =
              sideProjects.length === 1
                ? "col-span-12 md:col-span-12"
                : sideProjects.length === 2
                  ? "col-span-12 md:col-span-6"
                  : "col-span-12 md:col-span-4";
            return sideProjects.map((p, i) => (
              <Card
                key={p.id}
                className={`${sideSpanClass} row-span-2 p-0 overflow-hidden group`}
                delay={11 + i}
              >
                <SideProjectCard project={p} />
              </Card>
            ));
          })()}

          {/* Row 6: career (7) + education (5) — both fill, regardless of
               how short education is, by setting row-span = 2 (compact) */}
          {showWork && showEdu && (
            <>
              <Card className="col-span-12 md:col-span-7 row-span-3 p-5" delay={14}>
                <CareerCard work={r.work.slice(0, 6)} />
              </Card>
              <Card className="col-span-12 md:col-span-5 row-span-3 p-5" delay={15}>
                <EducationCard education={r.education} />
              </Card>
            </>
          )}
          {showWork && !showEdu && (
            <Card className="col-span-12 row-span-3 p-5" delay={14}>
              <CareerCard work={r.work.slice(0, 6)} />
            </Card>
          )}
          {!showWork && showEdu && (
            <Card className="col-span-12 row-span-2 p-5" delay={15}>
              <EducationCard education={r.education} />
            </Card>
          )}

          {/* Row 7: extras — dynamically sized to fill 12 */}
          {extras.map((ex, i) => (
            <Card
              key={ex.id}
              className={`${extraSpanClass} row-span-3 p-5`}
              delay={16 + i}
            >
              {ex.id === "hack" && <HackathonsCard hackathons={r.hackathons} />}
              {ex.id === "pubs" && <PublicationsCard publications={r.publications} />}
              {ex.id === "build" && <BuildLogCard buildLog={r.buildLog} />}
            </Card>
          ))}

          {/* Final: contact CTA */}
          <Card className="col-span-12 row-span-2 p-5 sm:p-7" tone="hero" delay={20}>
            <ContactCard email={r.contact.email} socials={socials} name={r.person.name} />
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────  Card primitives  ────────────────────────── */

type Tone = "default" | "bright" | "hero";

function Card({
  children,
  className = "",
  tone = "default",
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  tone?: Tone;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      setCoords({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    };
    const onLeave = () => setCoords(null);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  const baseBg =
    tone === "bright"
      ? "bg-gradient-to-br from-violet-500/[0.10] via-fuchsia-500/[0.04] to-transparent"
      : tone === "hero"
        ? "bg-gradient-to-br from-violet-500/[0.18] via-transparent to-cyan-500/[0.10]"
        : "bg-white/[0.025]";

  const spotlight: CSSProperties | undefined =
    coords && tone !== "hero"
      ? {
          background: `radial-gradient(360px circle at ${coords.x}px ${coords.y}px, rgba(167,139,250,0.10), transparent 60%)`,
        }
      : undefined;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, filter: "blur(6px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{ delay: delay * STAGGER, duration: 0.45, ease: "easeOut" }}
      whileHover={{ y: -2, transition: { duration: 0.15 } }}
      ref={ref}
      className={`relative rounded-[18px] border border-white/[0.08] ${baseBg} backdrop-blur-sm shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset,0_20px_50px_-30px_rgba(0,0,0,0.4)] overflow-hidden ${className}`}
    >
      {spotlight && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 transition-opacity duration-300"
          style={spotlight}
        />
      )}
      <div className="relative h-full w-full">{children}</div>
    </motion.div>
  );
}

function CardLabel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`text-[10px] tracking-[0.22em] uppercase text-neutral-400 font-semibold ${className}`}
    >
      {children}
    </div>
  );
}

/* ─────────────────────────  Background  ────────────────────────── */

function Aurora() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1.5, ease: "easeOut" }}
        className="absolute inset-x-0 top-0 h-[800px]"
        style={{
          background:
            "radial-gradient(ellipse 800px 600px at 30% 0%, rgba(167,139,250,0.18), transparent 60%), radial-gradient(ellipse 600px 400px at 70% 10%, rgba(56,189,248,0.10), transparent 60%)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.025) 1px, transparent 0)",
          backgroundSize: "32px 32px",
        }}
      />
    </div>
  );
}

/* ─────────────────────────  Card content  ────────────────────────── */

function TopBar({
  handle,
  socials,
}: {
  handle: string;
  socials: ReturnType<typeof allSocials>;
}) {
  return (
    <motion.header
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="flex items-center justify-between mb-3"
    >
      <span className="text-[12px] tracking-[0.15em] uppercase text-neutral-500 inline-flex items-center gap-2">
        <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
        @{handle}
      </span>
      <nav className="flex items-center gap-1.5 text-[12px] text-neutral-300">
        {socials.slice(0, 4).map((s) => (
          <a
            key={s.url}
            href={s.url}
            target="_blank"
            rel="noreferrer"
            className="px-2.5 py-1 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all"
          >
            {s.name}
          </a>
        ))}
      </nav>
    </motion.header>
  );
}

function Hero({ r }: { r: ReturnType<typeof useResume> }) {
  return (
    <>
      <div>
        <CardLabel className="text-violet-300 mb-2.5 inline-flex items-center gap-1.5">
          <Sparkles className="size-3" />
          Hello there
        </CardLabel>
        <h1 className="text-3xl sm:text-5xl font-semibold tracking-tight leading-[1.02]">
          I'm{" "}
          <span className="bg-gradient-to-r from-white via-violet-100 to-violet-300 bg-clip-text text-transparent">
            {r.person.name}
          </span>
          .
        </h1>
        <p className="mt-4 text-base sm:text-lg text-neutral-300 max-w-2xl leading-snug">
          {r.person.description}
        </p>
      </div>
      <div className="flex items-center justify-between flex-wrap gap-3 mt-5">
        <div className="text-[12.5px] text-neutral-400 inline-flex items-center gap-3">
          {r.person.location && (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden>📍</span>
              {r.person.location}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Available
          </span>
        </div>
        {r.contact.email && (
          <a
            href={`mailto:${r.contact.email}`}
            className="inline-flex items-center gap-1.5 text-[13px] text-violet-200 hover:text-white transition-colors group"
          >
            Get in touch
            <ArrowUpRight className="size-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </a>
        )}
      </div>
    </>
  );
}

function AvatarCard({ r }: { r: ReturnType<typeof useResume> }) {
  if (!r.person.avatarUrl) {
    return (
      <div className="flex items-center justify-center w-full h-full bg-gradient-to-br from-violet-500/15 to-cyan-500/10">
        <Avatar className="size-32 ring-4 ring-white/10">
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
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
      <div className="absolute bottom-3 left-4 right-4">
        <CardLabel className="text-neutral-300 mb-1">Currently</CardLabel>
        <div className="text-base font-semibold text-white truncate">
          {r.work[0]?.title ?? "Building"}
        </div>
        <div className="text-[12px] text-neutral-300 truncate">
          {r.work[0]?.company ?? "Independently"}
        </div>
      </div>
    </div>
  );
}

interface Stat {
  label: string;
  value: number;
  suffix?: string;
  tone?: Tone;
}
function computeStats(r: ReturnType<typeof useResume>): Stat[] {
  return [
    { label: "Projects", value: r.projects.length },
    { label: "Skills", value: r.skills.length },
    { label: "Roles", value: r.work.length },
    { label: "Build log", value: r.buildLog.length, suffix: "+" },
  ];
}

function StatCard({ label, value, suffix }: Stat) {
  return (
    <>
      <CardLabel>{label}</CardLabel>
      <div className="text-2xl sm:text-3xl font-semibold tabular-nums tracking-tight">
        <CountUp to={value} />
        {suffix}
      </div>
    </>
  );
}

function CountUp({ to }: { to: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const dur = 800;
    const tick = (t: number) => {
      const progress = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - progress, 3);
      setN(Math.round(to * eased));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return <span>{n}</span>;
}

function AboutCard({ summary }: { summary: string }) {
  return (
    <>
      <CardLabel className="mb-3">About</CardLabel>
      <div className="prose prose-invert max-w-none text-[14px] leading-[1.65] text-neutral-300 [&_p]:mb-2.5 [&_p:last-child]:mb-0 [&_a]:text-violet-300 [&_a]:underline-offset-2 hover:[&_a]:underline [&_strong]:text-white overflow-hidden">
        <Markdown>{summary}</Markdown>
      </div>
    </>
  );
}

function FeaturedProjectCard({
  project,
}: {
  project: ReturnType<typeof useResume>["projects"][number];
}) {
  return (
    <a
      href={project.href ?? "#"}
      target="_blank"
      rel="noreferrer"
      className="block w-full h-full relative"
    >
      {project.video ? (
        <video
          src={project.video}
          muted
          loop
          playsInline
          autoPlay
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.05]"
        />
      ) : project.image ? (
        <img
          src={project.image}
          alt={project.title}
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.05]"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-violet-500/30 to-cyan-500/20" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/40 to-transparent" />
      <div className="absolute top-3 right-3 flex items-center gap-1.5 px-2 py-1 rounded-full bg-white/15 backdrop-blur-sm text-[10px] font-semibold text-white tracking-wider uppercase">
        <Sparkles className="size-3" />
        Featured
      </div>
      <div className="absolute bottom-0 left-0 right-0 p-5">
        <div className="text-[10px] tracking-[0.2em] uppercase text-violet-200 font-semibold mb-1">
          {project.dates}
        </div>
        <h3 className="text-xl sm:text-2xl font-semibold mb-1.5 leading-tight inline-flex items-baseline gap-2">
          {project.title}
          <ArrowUpRight className="size-4 transition-transform group-hover:rotate-12" />
        </h3>
        <p className="text-[13px] text-neutral-200 line-clamp-2 mb-2.5">{project.description}</p>
        {project.technologies.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {project.technologies.slice(0, 4).map((t) => (
              <span
                key={t}
                className="text-[10.5px] px-1.5 py-0.5 rounded-full bg-white/15 text-white backdrop-blur-sm"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
    </a>
  );
}

function SideProjectCard({
  project,
}: {
  project: ReturnType<typeof useResume>["projects"][number];
}) {
  return (
    <a
      href={project.href ?? "#"}
      target="_blank"
      rel="noreferrer"
      className="block w-full h-full relative"
    >
      {project.image ? (
        <img
          src={project.image}
          alt={project.title}
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.05]"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-neutral-800 to-neutral-900" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 p-3.5">
        <h4 className="font-semibold text-white text-sm inline-flex items-baseline gap-1.5">
          {project.title}
          <ArrowUpRight className="size-3 opacity-70 transition-transform group-hover:rotate-12" />
        </h4>
        <p className="text-[11.5px] text-neutral-300 line-clamp-1 mt-0.5">
          {stripMd(project.description).split("\n")[0]}
        </p>
        {project.technologies.length > 0 && (
          <div className="text-[10.5px] text-neutral-400 mt-1 truncate">
            {project.technologies.slice(0, 3).join(" · ")}
          </div>
        )}
      </div>
    </a>
  );
}

function SkillsCard({
  skills,
}: {
  skills: ReturnType<typeof useResume>["skills"];
}) {
  return (
    <>
      <CardLabel className="mb-3">Toolbox</CardLabel>
      <div className="flex flex-wrap gap-1.5">
        {skills.map((s) => {
          const Icon = resolveSkillIcon(s.iconKey ?? s.name);
          return (
            <motion.span
              key={s.name}
              whileHover={{ y: -2, transition: { duration: 0.15 } }}
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-[12px] text-neutral-200 hover:bg-white/10 hover:border-white/20 transition-all cursor-default"
              title={
                s.usageCount
                  ? `Used in ${s.usageCount} repo${s.usageCount === 1 ? "" : "s"}`
                  : undefined
              }
            >
              {Icon && <Icon className="size-3" />}
              {s.name}
            </motion.span>
          );
        })}
      </div>
    </>
  );
}

function CurrentlyCard({
  work,
  compact = false,
}: {
  work: ReturnType<typeof useResume>["work"][number];
  compact?: boolean;
}) {
  return (
    <>
      <CardLabel className="text-cyan-300 mb-3">Currently</CardLabel>
      <div className="flex items-start gap-3">
        <LogoOrInitials src={work.logoUrl} name={work.company} />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-[15px] text-white">{work.title}</div>
          <div className="text-[13px] text-neutral-300 truncate">{work.company}</div>
          <div className="text-[11.5px] text-neutral-500 tabular-nums mt-0.5">
            since {work.start}
          </div>
        </div>
      </div>
      {!compact && work.description && (
        <p className="text-[12.5px] text-neutral-400 leading-relaxed line-clamp-2 mt-3">
          {stripMd(work.description).split("\n")[0]}
        </p>
      )}
    </>
  );
}

function CareerCard({
  work,
}: {
  work: ReturnType<typeof useResume>["work"];
}) {
  return (
    <>
      <CardLabel className="mb-3">Career timeline</CardLabel>
      <ol className="space-y-3">
        {work.map((w, i) => (
          <li key={w.id} className="flex items-start gap-3">
            <div className="relative flex-none">
              <LogoOrInitials src={w.logoUrl} name={w.company} />
              {i < work.length - 1 && (
                <span
                  aria-hidden
                  className="absolute top-[100%] left-1/2 -translate-x-1/2 h-3 w-px bg-white/10"
                />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-[13.5px]">
                {w.title}{" "}
                <span className="text-neutral-500">·</span>{" "}
                <span className="text-neutral-300">{w.company}</span>
              </div>
              <div className="text-[11.5px] text-neutral-500 tabular-nums">
                {w.start} – {w.end}
                {w.location && ` · ${w.location}`}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}

function EducationCard({
  education,
}: {
  education: ReturnType<typeof useResume>["education"];
}) {
  return (
    <>
      <CardLabel className="mb-3">Education</CardLabel>
      <ul className="space-y-3">
        {education.map((e) => (
          <li key={e.id} className="flex items-start gap-3">
            <LogoOrInitials src={e.logoUrl} name={e.school} />
            <div className="flex-1 min-w-0">
              <div className="font-medium text-[13.5px] truncate">{e.school}</div>
              <div className="text-[12.5px] text-neutral-400 line-clamp-2">{e.degree}</div>
              <div className="text-[11.5px] text-neutral-500 tabular-nums mt-0.5">
                {e.start} – {e.end}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function HackathonsCard({
  hackathons,
}: {
  hackathons: ReturnType<typeof useResume>["hackathons"];
}) {
  return (
    <>
      <CardLabel className="mb-3">Hackathons</CardLabel>
      <ul className="space-y-2.5 text-[13px]">
        {hackathons.slice(0, 6).map((h) => (
          <li key={h.id} className="border-l-2 border-violet-400/40 pl-3">
            <div className="font-medium text-white truncate">{h.title}</div>
            {h.rank && <div className="text-[11.5px] text-violet-300">★ {h.rank}</div>}
            {h.date && (
              <div className="text-[11px] text-neutral-500 tabular-nums">{h.date}</div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

function PublicationsCard({
  publications,
}: {
  publications: ReturnType<typeof useResume>["publications"];
}) {
  return (
    <>
      <CardLabel className="mb-3">Publications</CardLabel>
      <ul className="space-y-2.5 text-[13px]">
        {publications.slice(0, 6).map((p) => (
          <li key={p.id}>
            <a
              href={p.url}
              target="_blank"
              rel="noreferrer"
              className="text-neutral-100 hover:text-violet-300 inline-flex items-baseline gap-1 group"
            >
              <span className="line-clamp-2">{p.title}</span>
              <ArrowUpRight className="size-3 opacity-0 group-hover:opacity-100 transition-opacity flex-none" />
            </a>
            {p.venue && (
              <div className="text-[11.5px] text-neutral-500 italic truncate">{p.venue}</div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

function BuildLogCard({
  buildLog,
}: {
  buildLog: ReturnType<typeof useResume>["buildLog"];
}) {
  return (
    <>
      <CardLabel className="mb-3">Build log</CardLabel>
      <ol className="space-y-2 text-[12.5px]">
        {buildLog.slice(0, 8).map((b) => (
          <li key={b.id} className="flex items-baseline gap-2 leading-snug">
            <span
              aria-hidden
              className="size-1.5 rounded-full flex-none translate-y-1"
              style={{ backgroundColor: b.languageColor ?? "#a78bfa" }}
            />
            <div className="flex-1 min-w-0">
              <div className="text-neutral-100 truncate">
                <span className="font-medium">{b.title}</span>
                <span className="text-neutral-500"> — {b.description}</span>
              </div>
              <div className="text-[10.5px] text-neutral-600 tabular-nums">{b.dates}</div>
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}

function ContactCard({
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
    <div className="flex items-center justify-between flex-wrap gap-4 h-full">
      <div>
        <div className="text-xl sm:text-2xl font-semibold tracking-tight">
          Let's build something, {firstName}-style.
        </div>
        <div className="text-neutral-400 text-[13px] mt-0.5">
          I'm reachable, and I read every email.
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {email && (
          <a
            href={`mailto:${email}`}
            className="px-4 py-2 rounded-full bg-white text-black font-medium text-[13.5px] hover:bg-neutral-100 transition-all hover:-translate-y-px shadow-lg shadow-white/5 inline-flex items-center gap-1.5"
          >
            Email me
            <ArrowUpRight className="size-3.5" />
          </a>
        )}
        {socials.slice(0, 3).map((s) => (
          <a
            key={s.url}
            href={s.url}
            target="_blank"
            rel="noreferrer"
            className="px-4 py-2 rounded-full bg-white/10 border border-white/10 text-[13.5px] hover:bg-white/15 hover:border-white/20 hover:-translate-y-px transition-all"
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
