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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { LogoOrInitials } from "@/components/logo-or-initials";
import { resolveSkillIcon } from "@/components/skill-icons";
import { formatResumeDate, formatResumeDateRange } from "@/lib/format-date";
import { ArrowUpRight } from "lucide-react";

/**
 * Bento — premium minimalistic bento grid.
 *
 * Subtle, restrained, intentional. Cards have generous whitespace,
 * one focal element each, soft borders, and a single cohesive blue
 * accent throughout. The layout adapts to data density so we never
 * have a card cut off mid-content or a row with empty columns.
 *
 * Best for: full-stack devs, product engineers, and visual thinkers.
 */
const STAGGER = 0.04;

// Cohesive blue palette — used throughout, not a rainbow.
const ACCENT = "#3b82f6"; // blue-500
const ACCENT_LIGHT = "#60a5fa"; // blue-400
const ACCENT_DEEP = "#1e40af"; // blue-800

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
    [r.skills.length, r.projects.length, r.work.length, r.buildLog.length],
  );

  const showWork = !hidden.has("work") && r.work.length > 0;
  const showEdu = !hidden.has("education") && r.education.length > 0;
  const showHack = !hidden.has("hackathons") && r.hackathons.length > 0;
  const showPubs = !hidden.has("publications") && r.publications.length > 0;
  const showBuild = !hidden.has("buildLog") && r.buildLog.length > 0;

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
    <div
      className="min-h-dvh text-neutral-100 antialiased"
      style={{ background: "#06070a" }}
    >
      <Aurora />

      <div className="relative z-10 mx-auto max-w-[1280px] px-4 sm:px-6 py-8 sm:py-12">
        <TopBar handle={handle} socials={socials} />

        {/* Density goes up: smaller min row height, generous gaps */}
        <div className="grid grid-cols-12 gap-3 sm:gap-4 auto-rows-[110px]">
          {/* Row 1: hero (8) + avatar (4) */}
          <Card className="col-span-12 md:col-span-8 row-span-3 p-7 sm:p-9 flex flex-col justify-between" tone="hero" delay={1}>
            <Hero r={r} />
          </Card>

          <Card className="col-span-12 md:col-span-4 row-span-3 p-0 overflow-hidden" delay={2}>
            <AvatarCard r={r} />
          </Card>

          {/* Row 2: 4-up stat strip — always fills 12 */}
          {stats.map((s, i) => (
            <Card
              key={s.label}
              className="col-span-6 md:col-span-3 row-span-1 px-5 py-4 flex flex-col justify-between"
              delay={3 + i}
            >
              <StatCard {...s} />
            </Card>
          ))}

          {/* Row 3: about (7) + featured project (5) */}
          {featured ? (
            <>
              <Card className="col-span-12 md:col-span-7 row-span-3 p-6" delay={7}>
                <AboutCard summary={r.person.summary} />
              </Card>
              <Card className="col-span-12 md:col-span-5 row-span-3 p-0 overflow-hidden group" delay={8}>
                <FeaturedProjectCard project={featured} />
              </Card>
            </>
          ) : (
            <Card className="col-span-12 row-span-2 p-6" delay={7}>
              <AboutCard summary={r.person.summary} />
            </Card>
          )}

          {/* Row 4: skills (8) + currently (4) — currently is THE focal "now" card */}
          {r.skills.length > 0 && r.work[0] ? (
            <>
              <Card className="col-span-12 md:col-span-8 row-span-2 p-6" delay={9}>
                <SkillsCard skills={r.skills} />
              </Card>
              <Card className="col-span-12 md:col-span-4 row-span-2 p-6" delay={10} tone="bright">
                <CurrentlyCard work={r.work[0]} />
              </Card>
            </>
          ) : r.skills.length > 0 ? (
            <Card className="col-span-12 row-span-2 p-6" delay={9}>
              <SkillsCard skills={r.skills} />
            </Card>
          ) : r.work[0] ? (
            <Card className="col-span-12 row-span-2 p-6" delay={10} tone="bright">
              <CurrentlyCard work={r.work[0]} />
            </Card>
          ) : null}

          {/* Row 5: side projects */}
          {sideProjects.length > 0 && (() => {
            const sideSpanClass =
              sideProjects.length === 1
                ? "col-span-12"
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

          {/* Row 6: career roster — full width with horizontal cards.
               Only the 4 most recent roles, no overflow possible. */}
          {showWork && (
            <Card className="col-span-12 row-span-2 p-6" delay={14}>
              <CareerRoster work={r.work.slice(0, 4)} />
            </Card>
          )}

          {/* Row 7: education — full width if no extras, half if extras present */}
          {showEdu && (
            <Card
              className={
                extras.length > 0
                  ? "col-span-12 md:col-span-5 row-span-2 p-6"
                  : "col-span-12 row-span-2 p-6"
              }
              delay={15}
            >
              <EducationCard education={r.education.slice(0, 3)} />
            </Card>
          )}

          {/* Extras row — only if data present, sized to fill remaining cols */}
          {extras.map((ex, i) => {
            const cls =
              showEdu && extras.length > 0
                ? extras.length === 1
                  ? "col-span-12 md:col-span-7 row-span-2 p-6"
                  : extras.length === 2
                    ? "col-span-12 md:col-span-7 row-span-2 p-6"
                    : `${extraSpanClass} row-span-2 p-6`
                : `${extraSpanClass} row-span-2 p-6`;
            return (
              <Card key={ex.id} className={cls} delay={16 + i}>
                {ex.id === "hack" && <HackathonsCard hackathons={r.hackathons} />}
                {ex.id === "pubs" && <PublicationsCard publications={r.publications} />}
                {ex.id === "build" && <BuildLogCard buildLog={r.buildLog} />}
              </Card>
            );
          })}

          {/* Final: contact CTA */}
          <Card className="col-span-12 row-span-2 p-6 sm:p-8" tone="hero" delay={20}>
            <ContactCard email={r.contact.email} socials={socials} name={r.person.name} />
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────  Card primitive  ────────────────────────── */

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

  // Restrained tones — the same blue, just more or less of it.
  // No 3-color rainbow gradients (those read as "AI generated").
  const baseBg =
    tone === "hero"
      ? "bg-[radial-gradient(ellipse_at_top_left,rgba(59,130,246,0.12),transparent_60%)]"
      : tone === "bright"
        ? "bg-[radial-gradient(ellipse_at_top,rgba(34,211,238,0.08),transparent_60%)]"
        : "bg-white/[0.018]";

  const spotlight: CSSProperties | undefined = coords
    ? {
        background: `radial-gradient(280px circle at ${coords.x}px ${coords.y}px, rgba(96,165,250,0.06), transparent 60%)`,
      }
    : undefined;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{ delay: delay * STAGGER, duration: 0.5, ease: "easeOut" }}
      whileHover={{ y: -1, transition: { duration: 0.18 } }}
      ref={ref}
      className={`relative rounded-[20px] border border-white/[0.05] ${baseBg} backdrop-blur-sm overflow-hidden ${className}`}
      style={{
        boxShadow:
          "inset 0 1px 0 0 rgba(255,255,255,0.03), 0 12px 32px -16px rgba(0,0,0,0.4)",
      }}
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
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={`text-[10.5px] tracking-[0.22em] uppercase text-neutral-500 font-medium ${className}`}
      style={style}
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
        className="absolute inset-x-0 top-0 h-[700px]"
        style={{
          background:
            "radial-gradient(ellipse 900px 500px at 35% -100px, rgba(59,130,246,0.16), transparent 60%), radial-gradient(ellipse 700px 400px at 75% 0%, rgba(34,211,238,0.08), transparent 60%)",
        }}
      />
      <div
        className="absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.025) 1px, transparent 0)",
          backgroundSize: "32px 32px",
        }}
      />
    </div>
  );
}

/* ─────────────────────────  Top bar  ────────────────────────── */

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
      className="flex items-center justify-between mb-4"
    >
      <span
        className="text-[12px] tracking-[0.15em] uppercase text-neutral-500 inline-flex items-center gap-2"
        style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace" }}
      >
        <span
          className="size-1.5 rounded-full bg-emerald-400"
          style={{ boxShadow: "0 0 8px rgba(52,211,153,0.5)" }}
        />
        @{handle}
      </span>
      <nav className="flex items-center gap-1.5 text-[12.5px] text-neutral-300">
        {socials.slice(0, 4).map((s) => (
          <a
            key={s.url}
            href={s.url}
            target="_blank"
            rel="noreferrer"
            className="px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/[0.05] hover:bg-white/[0.07] hover:border-white/[0.10] transition-all"
          >
            {s.name}
          </a>
        ))}
      </nav>
    </motion.header>
  );
}

/* ─────────────────────────  Hero  ────────────────────────── */

function Hero({ r }: { r: ReturnType<typeof useResume> }) {
  return (
    <>
      <div>
        <CardLabel className="mb-3" style={{ color: ACCENT_LIGHT }}>
          Hello there
        </CardLabel>
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-[-0.02em] leading-[1.05]">
          I'm{" "}
          <span
            className="bg-clip-text text-transparent"
            style={{
              backgroundImage: `linear-gradient(135deg, #ffffff 30%, ${ACCENT_LIGHT} 80%)`,
              ["WebkitBackgroundClip" as string]: "text",
            }}
          >
            {r.person.name}
          </span>
          .
        </h1>
        <p className="mt-4 text-[16px] sm:text-lg text-neutral-300 max-w-2xl leading-snug">
          {r.person.description}
        </p>
      </div>
      <div className="flex items-center justify-between flex-wrap gap-3 mt-6">
        <div
          className="text-[12.5px] text-neutral-400 inline-flex items-center gap-3"
          style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace" }}
        >
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
            className="inline-flex items-center gap-1.5 text-[13px] hover:text-white transition-colors group"
            style={{ color: ACCENT_LIGHT }}
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
      <div className="flex items-center justify-center w-full h-full bg-[radial-gradient(ellipse_at_center,rgba(59,130,246,0.12),transparent_70%)]">
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
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
      <div className="absolute bottom-4 left-5 right-5">
        <CardLabel className="mb-1" style={{ color: "#cbd5e1" }}>
          Currently
        </CardLabel>
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

/* ─────────────────────────  Stats  ────────────────────────── */

interface Stat {
  label: string;
  value: number;
  suffix?: string;
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
      <div className="text-[28px] sm:text-[32px] font-semibold tabular-nums tracking-tight leading-none">
        <CountUp to={value} />
        <span style={{ color: ACCENT_LIGHT }}>{suffix}</span>
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

/* ─────────────────────────  About  ────────────────────────── */

function AboutCard({ summary }: { summary: string }) {
  return (
    <>
      <CardLabel className="mb-3">About</CardLabel>
      <div className="prose prose-invert max-w-none text-[14px] leading-[1.7] text-neutral-300 [&_p]:mb-2.5 [&_p:last-child]:mb-0 [&_strong]:text-white overflow-hidden">
        <Markdown
          components={{
            a: ({ href, children }) => (
              <a
                href={href}
                style={{ color: ACCENT_LIGHT }}
                className="underline-offset-2 hover:underline"
              >
                {children}
              </a>
            ),
          }}
        >
          {summary}
        </Markdown>
      </div>
    </>
  );
}

/* ─────────────────────────  Featured project  ────────────────────────── */

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
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(135deg, ${ACCENT_DEEP}, ${ACCENT})`,
          }}
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/30 to-transparent" />
      <div
        className="absolute top-3 right-3 px-2 py-0.5 rounded-full text-[10px] font-medium text-white tracking-wider uppercase"
        style={{ background: "rgba(255,255,255,0.14)", backdropFilter: "blur(8px)" }}
      >
        Featured
      </div>
      <div className="absolute bottom-0 left-0 right-0 p-5">
        <div
          className="text-[10.5px] tracking-[0.2em] uppercase font-medium mb-1.5"
          style={{ color: ACCENT_LIGHT }}
        >
          {project.dates}
        </div>
        <h3 className="text-xl sm:text-2xl font-semibold mb-1.5 leading-tight inline-flex items-baseline gap-2">
          {project.title}
          <ArrowUpRight className="size-4 transition-transform group-hover:rotate-12" />
        </h3>
        <p className="text-[13px] text-neutral-200 line-clamp-2 mb-2.5">
          {stripMd(project.description)}
        </p>
        {project.technologies.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {project.technologies.slice(0, 4).map((t) => (
              <span
                key={t}
                className="text-[10.5px] px-1.5 py-0.5 rounded-full bg-white/[0.12] text-white"
                style={{ backdropFilter: "blur(4px)" }}
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

/* ─────────────────────────  Side projects  ────────────────────────── */

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
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(135deg, rgba(30,64,175,0.4), rgba(8,12,20,1))`,
          }}
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 p-4">
        <h4 className="font-semibold text-white text-[14.5px] inline-flex items-baseline gap-1.5">
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

/* ─────────────────────────  Skills  ────────────────────────── */

function SkillsCard({
  skills,
}: {
  skills: ReturnType<typeof useResume>["skills"];
}) {
  return (
    <>
      <CardLabel className="mb-4">Toolbox</CardLabel>
      <div className="flex flex-wrap gap-1.5">
        {skills.map((s) => {
          const Icon = resolveSkillIcon(s.iconKey ?? s.name);
          return (
            <motion.span
              key={s.name}
              whileHover={{ y: -2, transition: { duration: 0.15 } }}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/[0.04] border border-white/[0.05] text-[12.5px] text-neutral-200 hover:bg-white/[0.07] hover:border-white/[0.12] transition-all cursor-default"
              title={
                s.usageCount
                  ? `Used in ${s.usageCount} repo${s.usageCount === 1 ? "" : "s"}`
                  : undefined
              }
            >
              {Icon && <Icon className="size-3.5" />}
              {s.name}
            </motion.span>
          );
        })}
      </div>
    </>
  );
}

/* ─────────────────────────  Currently  ────────────────────────── */

function CurrentlyCard({
  work,
}: {
  work: ReturnType<typeof useResume>["work"][number];
}) {
  return (
    <>
      <CardLabel className="mb-4 inline-flex items-center gap-2" style={{ color: ACCENT_LIGHT }}>
        <span
          aria-hidden
          className="size-1.5 rounded-full bg-emerald-400 animate-pulse"
          style={{ boxShadow: "0 0 6px rgba(52,211,153,0.6)" }}
        />
        Currently
      </CardLabel>
      <div className="flex items-start gap-3">
        <LogoOrInitials src={work.logoUrl} name={work.company} />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-[15px] text-white">{work.title}</div>
          <div className="text-[13px] text-neutral-300 truncate">{work.company}</div>
          <div className="text-[11.5px] text-neutral-500 tabular-nums mt-0.5 font-mono">
            since {formatResumeDate(work.start)}
          </div>
        </div>
      </div>
      {work.description && (
        <p className="text-[12.5px] text-neutral-400 leading-relaxed line-clamp-2 mt-4">
          {stripMd(work.description).split("\n")[0]}
        </p>
      )}
    </>
  );
}

/* ─────────────────────────  Career roster — horizontal, no cutoff  ────────────────────────── */

function CareerRoster({
  work,
}: {
  work: ReturnType<typeof useResume>["work"];
}) {
  return (
    <>
      <div className="flex items-baseline justify-between gap-2 mb-4">
        <CardLabel>Recent roles</CardLabel>
        <span className="text-[10.5px] text-neutral-600 font-mono tabular-nums">
          showing {work.length} of {work.length}
        </span>
      </div>
      <ol className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {work.map((w) => (
          <li
            key={w.id}
            className="rounded-xl bg-white/[0.018] border border-white/[0.04] p-3 hover:bg-white/[0.035] hover:border-white/[0.08] transition-all"
          >
            <div className="flex items-start gap-2.5 mb-2">
              <LogoOrInitials src={w.logoUrl} name={w.company} />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-[13px] truncate">{w.title}</div>
                <div className="text-[11.5px] text-neutral-400 truncate">{w.company}</div>
              </div>
            </div>
            <div className="text-[10.5px] text-neutral-500 tabular-nums font-mono">
              {formatResumeDateRange(w.start, w.end)}
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}

/* ─────────────────────────  Education  ────────────────────────── */

function EducationCard({
  education,
}: {
  education: ReturnType<typeof useResume>["education"];
}) {
  return (
    <>
      <CardLabel className="mb-4">Education</CardLabel>
      <ul className="space-y-3">
        {education.map((e) => (
          <li key={e.id} className="flex items-start gap-3">
            <LogoOrInitials src={e.logoUrl} name={e.school} />
            <div className="flex-1 min-w-0">
              <div className="font-medium text-[13.5px] truncate">{e.school}</div>
              <div className="text-[12.5px] text-neutral-400 line-clamp-2">{e.degree}</div>
              <div className="text-[11px] text-neutral-500 tabular-nums mt-0.5 font-mono">
                {formatResumeDateRange(e.start, e.end)}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

/* ─────────────────────────  Hackathons  ────────────────────────── */

function HackathonsCard({
  hackathons,
}: {
  hackathons: ReturnType<typeof useResume>["hackathons"];
}) {
  return (
    <>
      <CardLabel className="mb-4">Hackathons</CardLabel>
      <ul className="space-y-2.5 text-[13px]">
        {hackathons.slice(0, 4).map((h) => (
          <li key={h.id} className="border-l-2 pl-3" style={{ borderColor: `${ACCENT}66` }}>
            <div className="font-medium text-white truncate">{h.title}</div>
            {h.rank && (
              <div className="text-[11.5px]" style={{ color: ACCENT_LIGHT }}>
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

/* ─────────────────────────  Publications  ────────────────────────── */

function PublicationsCard({
  publications,
}: {
  publications: ReturnType<typeof useResume>["publications"];
}) {
  return (
    <>
      <CardLabel className="mb-4">Publications</CardLabel>
      <ul className="space-y-2.5 text-[13px]">
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
                style={{ color: ACCENT_LIGHT }}
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

/* ─────────────────────────  Build log  ────────────────────────── */

function BuildLogCard({
  buildLog,
}: {
  buildLog: ReturnType<typeof useResume>["buildLog"];
}) {
  return (
    <>
      <CardLabel className="mb-4">Recently shipping</CardLabel>
      <ol className="space-y-2 text-[12.5px]">
        {buildLog.slice(0, 6).map((b) => (
          <li key={b.id} className="flex items-baseline gap-2 leading-snug">
            <span
              aria-hidden
              className="size-1.5 rounded-full flex-none translate-y-1"
              style={{ backgroundColor: b.languageColor ?? ACCENT_LIGHT }}
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

/* ─────────────────────────  Contact  ────────────────────────── */

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
        <div className="text-xl sm:text-2xl font-semibold tracking-[-0.01em]">
          Let's build something, {firstName}.
        </div>
        <div className="text-neutral-400 text-[13.5px] mt-0.5">
          I'm reachable, and I read every email.
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {email && (
          <a
            href={`mailto:${email}`}
            className="px-4 py-2 rounded-full bg-white text-black font-medium text-[13.5px] hover:bg-neutral-100 transition-all hover:-translate-y-px shadow-[0_8px_24px_-8px_rgba(96,165,250,0.4)] inline-flex items-center gap-1.5"
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
            className="px-4 py-2 rounded-full bg-white/[0.06] border border-white/[0.06] text-[13.5px] hover:bg-white/[0.10] hover:border-white/[0.12] hover:-translate-y-px transition-all"
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
