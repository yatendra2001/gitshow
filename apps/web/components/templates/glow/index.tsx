/* eslint-disable @next/next/no-img-element */
"use client";

import Markdown from "react-markdown";
import { motion, useScroll, useTransform } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useResume, useHandle } from "@/components/data-provider";
import { allSocials } from "@gitshow/shared/resume";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { LogoOrInitials } from "@/components/logo-or-initials";
import { resolveSkillIcon } from "@/components/skill-icons";
import { ArrowUpRight, Sparkles } from "lucide-react";

/**
 * Glow — modern dark portfolio with motion.
 *
 * Linear-meets-Aceternity vibe: animated mesh gradient hero with
 * mouse-tracking glow, gradient text on the name, dotted grid
 * background, infinite tech-stack marquee, "currently building"
 * status block with a pulsing dot, project cards with gradient
 * borders that glow on hover, fade-in-up on scroll for everything.
 *
 * Best for: AI builders, indie hackers, and anyone shipping
 * shadcn-grade UI today.
 */

const GRAD = {
  from: "#5e6ad2",
  via: "#bd9bff",
  to: "#fc7dab",
};

export default function GlowTemplate() {
  const r = useResume();
  const handle = useHandle();
  const hidden = new Set(r.sections.hidden);
  const socials = allSocials(r);

  return (
    <div
      className="min-h-dvh antialiased relative overflow-hidden"
      style={{ background: "#08080b", color: "#fafafa" }}
    >
      {/* Dotted grid background — fixed, very subtle */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.04) 1px, transparent 0)",
          backgroundSize: "24px 24px",
        }}
      />

      {/* Top mesh gradient — soft, only at the top. All blue, no purple residue. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 z-0 h-[800px]"
        style={{
          background:
            "radial-gradient(ellipse 1100px 700px at 50% -100px, rgba(59,130,246,0.20), transparent 60%), radial-gradient(ellipse 800px 500px at 80% 0%, rgba(14,165,233,0.12), transparent 60%), radial-gradient(ellipse 700px 400px at 10% 100px, rgba(99,102,241,0.10), transparent 60%)",
        }}
      />

      <Header handle={handle} socials={socials} />

      <main className="relative z-10 mx-auto max-w-[760px] px-5 sm:px-6 pt-20 sm:pt-28 pb-32">
        <Hero r={r} />

        {r.skills.length > 0 && <TechMarquee skills={r.skills} />}

        {r.work[0] && <CurrentlyBuilding work={r.work[0]} />}

        {!hidden.has("projects") && r.projects.length > 0 && (
          <Section eyebrow="Selected Work" title="Things I've shipped." delay={1}>
            <Projects projects={r.projects.slice(0, 6)} />
          </Section>
        )}

        {!hidden.has("work") && r.work.length > 1 && (
          <Section eyebrow="Career" title="Where I've worked." delay={2}>
            <Experience work={r.work} />
          </Section>
        )}

        {!hidden.has("publications") && r.publications.length > 0 && (
          <Section eyebrow="Writing" title="Things I've written." delay={3}>
            <WritingList publications={r.publications} blog={r.blog} />
          </Section>
        )}

        {!hidden.has("education") && r.education.length > 0 && (
          <Section eyebrow="Education" title="Where I learned." delay={4}>
            <EducationList education={r.education} />
          </Section>
        )}

        <About summary={r.person.summary} />

        <Contact email={r.contact.email} socials={socials} name={r.person.name} />
      </main>
    </div>
  );
}

/* ─────────────────────────  Header (sticky thin nav)  ────────────────────────── */

function Header({
  handle,
  socials,
}: {
  handle: string;
  socials: ReturnType<typeof allSocials>;
}) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <motion.header
      initial={{ y: -8, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className={`fixed inset-x-0 top-0 z-40 transition-all ${
        scrolled
          ? "bg-[#08080b]/70 backdrop-blur-xl border-b border-white/[0.06]"
          : "bg-transparent border-b border-transparent"
      }`}
    >
      <div className="mx-auto max-w-[760px] px-5 sm:px-6 h-14 flex items-center justify-between">
        <a
          href={`/${handle}`}
          className="text-[13px] font-mono text-neutral-300 hover:text-white transition-colors inline-flex items-center gap-2"
        >
          <span
            aria-hidden
            className="size-1.5 rounded-full"
            style={{
              background: `linear-gradient(135deg, ${GRAD.from}, ${GRAD.via}, ${GRAD.to})`,
              boxShadow: `0 0 12px ${GRAD.via}`,
            }}
          />
          @{handle}
        </a>
        <nav className="flex items-center gap-1 text-[12.5px] text-neutral-300">
          {socials.slice(0, 3).map((s) => (
            <a
              key={s.url}
              href={s.url}
              target="_blank"
              rel="noreferrer"
              className="px-2.5 py-1 rounded-md hover:bg-white/[0.06] hover:text-white transition-all"
            >
              {s.name}
            </a>
          ))}
        </nav>
      </div>
    </motion.header>
  );
}

/* ─────────────────────────  Hero  ────────────────────────── */

function Hero({ r }: { r: ReturnType<typeof useResume> }) {
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

  return (
    <div
      ref={ref}
      className="relative -mx-5 sm:-mx-6 px-5 sm:px-6 py-12 sm:py-16 rounded-[24px] overflow-hidden"
    >
      {/* Mouse-tracked spotlight — only inside the hero card */}
      {coords && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 transition-opacity duration-300"
          style={{
            background: `radial-gradient(800px circle at ${coords.x}px ${coords.y}px, rgba(96,165,250,0.12), transparent 50%)`,
          }}
        />
      )}

      <motion.div
        initial={{ opacity: 0, y: 8, filter: "blur(6px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="relative"
      >
        {/* Avatar pill — tiny, top-left */}
        <div className="flex items-center gap-3 mb-7">
          <Avatar className="size-10 ring-1 ring-white/10">
            <AvatarImage src={r.person.avatarUrl} alt={r.person.name} />
            <AvatarFallback className="bg-neutral-900 text-neutral-300 text-sm font-mono">
              {r.person.initials}
            </AvatarFallback>
          </Avatar>
          {r.person.location && (
            <span className="text-[12.5px] font-mono text-neutral-500 inline-flex items-center gap-2">
              <span
                aria-hidden
                className="size-1.5 rounded-full bg-emerald-400"
                style={{ boxShadow: "0 0 8px rgba(52,211,153,0.6)" }}
              />
              {r.person.location}
            </span>
          )}
        </div>

        {/* Name — gradient text */}
        <h1
          className="font-semibold leading-[1.05] tracking-[-0.025em] mb-5"
          style={{
            fontSize: "clamp(40px, 7vw, 72px)",
          }}
        >
          <span
            className="bg-clip-text text-transparent"
            style={{
              backgroundImage: `linear-gradient(135deg, #ffffff 30%, ${GRAD.via} 70%, ${GRAD.to})`,
              ["WebkitBackgroundClip" as string]: "text",
            }}
          >
            {r.person.name}
          </span>
        </h1>

        <p className="text-lg sm:text-xl text-neutral-300 leading-snug max-w-[40ch]">
          {r.person.description}
        </p>

        {/* CTAs */}
        <div className="mt-8 flex flex-wrap items-center gap-3">
          {r.contact.email && (
            <a
              href={`mailto:${r.contact.email}`}
              className="group inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-[13.5px] font-medium text-[#08080b] transition-all hover:-translate-y-px shadow-[0_8px_30px_-10px_rgba(59,130,246,0.55)]"
              style={{
                background: `linear-gradient(135deg, #fafafa, #ffffff)`,
              }}
            >
              Get in touch
              <ArrowUpRight className="size-3.5 transition-transform group-hover:rotate-12" />
            </a>
          )}
          <a
            href="#projects"
            className="px-4 py-2 rounded-full bg-white/[0.06] border border-white/[0.08] text-[13.5px] hover:bg-white/[0.10] hover:border-white/[0.14] transition-all"
          >
            See projects
          </a>
        </div>
      </motion.div>
    </div>
  );
}

/* ─────────────────────────  Tech marquee  ────────────────────────── */

function TechMarquee({
  skills,
}: {
  skills: ReturnType<typeof useResume>["skills"];
}) {
  // Take first 16 skills, double them for seamless loop.
  const items = skills.slice(0, 16);
  const doubled = [...items, ...items];
  return (
    <motion.section
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6, delay: 0.15 }}
      className="mt-14 -mx-5 sm:-mx-6 overflow-hidden"
      aria-label="Tech stack"
    >
      <div
        className="relative"
        style={{
          maskImage:
            "linear-gradient(to right, transparent 0%, black 12%, black 88%, transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to right, transparent 0%, black 12%, black 88%, transparent 100%)",
        }}
      >
        <div
          className="flex items-center gap-4 whitespace-nowrap py-1"
          style={{
            animation: "glow-marquee 60s linear infinite",
            width: "max-content",
          }}
        >
          {doubled.map((s, i) => {
            const Icon = resolveSkillIcon(s.iconKey ?? s.name);
            return (
              <span
                key={`${s.name}-${i}`}
                className="inline-flex items-center gap-1.5 text-[13px] font-mono text-neutral-400 px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.06] flex-none"
              >
                {Icon && <Icon className="size-3.5" />}
                {s.name}
              </span>
            );
          })}
        </div>
      </div>
      <style>{`
        @keyframes glow-marquee {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
      `}</style>
    </motion.section>
  );
}

/* ─────────────────────────  Currently building  ────────────────────────── */

function CurrentlyBuilding({
  work,
}: {
  work: ReturnType<typeof useResume>["work"][number];
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.5, delay: 0.1 }}
      className="mt-12"
    >
      <a
        href={work.href ?? "#"}
        target={work.href ? "_blank" : undefined}
        rel="noreferrer"
        className="group flex items-center gap-4 p-4 rounded-2xl bg-white/[0.025] border border-white/[0.06] hover:border-white/[0.14] hover:bg-white/[0.04] transition-all"
      >
        <div className="relative flex-none">
          <LogoOrInitials src={work.logoUrl} name={work.company} />
          <span
            aria-hidden
            className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-emerald-400 ring-2 ring-[#08080b]"
            style={{ boxShadow: "0 0 8px rgba(52,211,153,0.7)" }}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10.5px] font-mono uppercase tracking-[0.22em] text-emerald-400 mb-0.5">
            Currently
          </div>
          <div className="text-[14.5px] font-medium leading-tight">
            {work.title} <span className="text-neutral-400">at</span>{" "}
            <span className="group-hover:text-white transition-colors">{work.company}</span>
          </div>
          <div className="text-[12px] text-neutral-500 font-mono mt-0.5">
            since {work.start}
          </div>
        </div>
        <ArrowUpRight className="size-4 text-neutral-500 transition-transform group-hover:rotate-12 group-hover:text-white flex-none" />
      </a>
    </motion.section>
  );
}

/* ─────────────────────────  Section primitives  ────────────────────────── */

function Section({
  eyebrow,
  title,
  children,
  delay = 0,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
  delay?: number;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.55, delay: delay * 0.05, ease: "easeOut" }}
      className="mt-20"
      id={eyebrow.toLowerCase().replace(/\s+/g, "-")}
    >
      <header className="mb-7 flex items-baseline justify-between gap-3">
        <div>
          <div className="text-[10.5px] font-mono uppercase tracking-[0.22em] text-neutral-500 mb-2">
            {eyebrow}
          </div>
          <h2
            className="font-semibold tracking-[-0.02em] leading-tight"
            style={{ fontSize: "clamp(24px, 3.5vw, 32px)" }}
          >
            {title}
          </h2>
        </div>
      </header>
      {children}
    </motion.section>
  );
}

/* ─────────────────────────  Projects (gradient-border cards)  ────────────────────────── */

function Projects({
  projects,
}: {
  projects: ReturnType<typeof useResume>["projects"];
}) {
  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3" id="projects">
      {projects.map((p, i) => (
        <motion.li
          key={p.id}
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ duration: 0.4, delay: i * 0.04, ease: "easeOut" }}
        >
          <a
            href={p.href ?? "#"}
            target="_blank"
            rel="noreferrer"
            className="group relative block h-full rounded-2xl overflow-hidden"
          >
            {/* Gradient border via mask trick */}
            <div
              aria-hidden
              className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"
              style={{
                background: `linear-gradient(135deg, ${GRAD.from}, ${GRAD.via}, ${GRAD.to})`,
                padding: "1px",
                ["WebkitMask" as string]:
                  "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
                ["WebkitMaskComposite" as string]: "xor",
                maskComposite: "exclude",
              }}
            />
            <div className="relative h-full rounded-2xl bg-white/[0.03] border border-white/[0.06] group-hover:border-transparent transition-all overflow-hidden">
              {(p.image || p.video) && (
                <div className="aspect-[16/10] overflow-hidden bg-neutral-900 relative">
                  {p.video ? (
                    <video
                      src={p.video}
                      muted
                      loop
                      playsInline
                      autoPlay
                      className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
                    />
                  ) : (
                    <img
                      src={p.image}
                      alt={p.title}
                      className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
                    />
                  )}
                  <div
                    aria-hidden
                    className="absolute inset-0 bg-gradient-to-t from-[#08080b] via-transparent to-transparent opacity-70"
                  />
                </div>
              )}
              <div className="p-5">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[10.5px] font-mono uppercase tracking-wider text-neutral-500">
                    {p.dates}
                  </span>
                  {p.active && (
                    <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-400 inline-flex items-center gap-1">
                      <span
                        aria-hidden
                        className="size-1 rounded-full bg-emerald-400 animate-pulse"
                      />
                      live
                    </span>
                  )}
                </div>
                <h3 className="text-[16px] font-semibold leading-tight inline-flex items-baseline gap-1.5 group-hover:text-white transition-colors">
                  {p.title}
                  <ArrowUpRight className="size-3.5 opacity-50 transition-all group-hover:opacity-100 group-hover:rotate-12" />
                </h3>
                <p className="mt-2 text-[13.5px] text-neutral-400 leading-relaxed line-clamp-3">
                  {stripMd(p.description)}
                </p>
                {p.technologies.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {p.technologies.slice(0, 4).map((t) => (
                      <span
                        key={t}
                        className="text-[11px] font-mono px-1.5 py-0.5 rounded text-neutral-400"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </a>
        </motion.li>
      ))}
    </ul>
  );
}

/* ─────────────────────────  Experience  ────────────────────────── */

function Experience({
  work,
}: {
  work: ReturnType<typeof useResume>["work"];
}) {
  return (
    <ul className="space-y-1">
      {work.slice(1).map((w, i) => (
        <motion.li
          key={w.id}
          initial={{ opacity: 0, y: 6 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-30px" }}
          transition={{ duration: 0.35, delay: i * 0.03, ease: "easeOut" }}
        >
          <a
            href={w.href ?? "#"}
            target={w.href ? "_blank" : undefined}
            rel="noreferrer"
            className="group flex items-center gap-3 p-3 -mx-3 rounded-xl hover:bg-white/[0.04] transition-colors"
          >
            <LogoOrInitials src={w.logoUrl} name={w.company} />
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-medium leading-tight inline-flex items-baseline gap-1.5">
                <span>{w.title}</span>
                <span className="text-neutral-500">at</span>
                <span className="group-hover:text-white transition-colors">{w.company}</span>
              </div>
              {w.location && (
                <div className="text-[12px] text-neutral-500 truncate">{w.location}</div>
              )}
            </div>
            <div className="text-[11.5px] font-mono text-neutral-500 tabular-nums flex-none">
              {w.start} — {w.end}
            </div>
          </a>
        </motion.li>
      ))}
    </ul>
  );
}

/* ─────────────────────────  Writing list  ────────────────────────── */

function WritingList({
  publications,
  blog,
}: {
  publications: ReturnType<typeof useResume>["publications"];
  blog: ReturnType<typeof useResume>["blog"];
}) {
  const items = [
    ...publications.map((p) => ({
      key: p.id,
      title: p.title,
      kind: p.kind,
      date: p.publishedAt,
      url: p.url,
      meta: p.venue,
    })),
    ...blog.slice(0, 4).map((b) => ({
      key: b.slug,
      title: b.title,
      kind: "blog",
      date: formatShort(b.publishedAt),
      url: b.sourceUrl ?? "#",
      meta: b.summary,
    })),
  ];
  return (
    <ul className="space-y-1">
      {items.map((it, i) => (
        <motion.li
          key={it.key}
          initial={{ opacity: 0, y: 6 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-30px" }}
          transition={{ duration: 0.35, delay: i * 0.03, ease: "easeOut" }}
        >
          <a
            href={it.url}
            target="_blank"
            rel="noreferrer"
            className="group grid grid-cols-[auto_1fr_auto] items-baseline gap-3 p-3 -mx-3 rounded-xl hover:bg-white/[0.04] transition-colors"
          >
            <span className="text-[10.5px] font-mono uppercase tracking-[0.18em] text-neutral-500 w-14">
              {it.kind}
            </span>
            <div className="min-w-0">
              <div className="text-[14px] leading-tight inline-flex items-baseline gap-1.5 group-hover:text-white transition-colors">
                <span className="truncate">{it.title}</span>
                <ArrowUpRight className="size-3 opacity-0 group-hover:opacity-100 transition-opacity flex-none" />
              </div>
              {it.meta && (
                <div className="text-[12px] text-neutral-500 italic truncate">
                  {it.meta}
                </div>
              )}
            </div>
            {it.date && (
              <span className="text-[11.5px] font-mono text-neutral-500 tabular-nums">
                {it.date}
              </span>
            )}
          </a>
        </motion.li>
      ))}
    </ul>
  );
}

/* ─────────────────────────  Education  ────────────────────────── */

function EducationList({
  education,
}: {
  education: ReturnType<typeof useResume>["education"];
}) {
  return (
    <ul className="space-y-1">
      {education.map((e) => (
        <li
          key={e.id}
          className="flex items-center gap-3 p-3 -mx-3 rounded-xl hover:bg-white/[0.04] transition-colors"
        >
          <LogoOrInitials src={e.logoUrl} name={e.school} />
          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-medium leading-tight">{e.school}</div>
            <div className="text-[12.5px] text-neutral-400 truncate">{e.degree}</div>
          </div>
          <div className="text-[11.5px] font-mono text-neutral-500 tabular-nums flex-none">
            {e.start} — {e.end}
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ─────────────────────────  About  ────────────────────────── */

function About({ summary }: { summary: string }) {
  return (
    <Section eyebrow="About" title="A few more words." delay={5}>
      <article className="text-[15.5px] leading-[1.75] text-neutral-300 [&_p]:mb-4 [&_p:last-child]:mb-0 max-w-[60ch]">
        <Markdown
          components={{
            a: ({ href, children }) => (
              <a
                href={href}
                className="text-white underline underline-offset-[3px] decoration-white/30 hover:decoration-white transition-all"
              >
                {children}
              </a>
            ),
            strong: ({ children }) => <strong className="text-white font-semibold">{children}</strong>,
            em: ({ children }) => <em className="text-neutral-200 italic">{children}</em>,
            code: ({ children }) => (
              <code className="text-neutral-100 bg-white/[0.06] px-1.5 py-0.5 rounded font-mono text-[0.92em]">
                {children}
              </code>
            ),
          }}
        >
          {summary}
        </Markdown>
      </article>
    </Section>
  );
}

/* ─────────────────────────  Contact  ────────────────────────── */

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
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.55 }}
      className="mt-24"
    >
      <div
        className="relative rounded-3xl p-8 sm:p-12 overflow-hidden"
        style={{
          background:
            "radial-gradient(ellipse at top right, rgba(59,130,246,0.22), transparent 60%), radial-gradient(ellipse at bottom left, rgba(14,165,233,0.14), transparent 60%), rgba(255,255,255,0.025)",
        }}
      >
        <div
          aria-hidden
          className="absolute inset-0 rounded-3xl border border-white/[0.06]"
        />
        <div className="relative">
          <div className="text-[10.5px] font-mono uppercase tracking-[0.22em] text-neutral-400 mb-3">
            Get in touch
          </div>
          <h2
            className="font-semibold tracking-[-0.02em] leading-[1.1]"
            style={{ fontSize: "clamp(28px, 4.5vw, 40px)" }}
          >
            <span
              className="bg-clip-text text-transparent"
              style={{
                backgroundImage: `linear-gradient(135deg, #ffffff, ${GRAD.via})`,
                ["WebkitBackgroundClip" as string]: "text",
              }}
            >
              Let's build something, {firstName}.
            </span>
          </h2>
          <p className="mt-3 text-neutral-400 text-[14.5px] max-w-[44ch]">
            I read every email and reply within a couple of days.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-2.5">
            {email && (
              <a
                href={`mailto:${email}`}
                className="group inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-white text-[#08080b] text-[13.5px] font-medium hover:-translate-y-px transition-all shadow-[0_8px_30px_-10px_rgba(59,130,246,0.55)]"
              >
                {email}
                <ArrowUpRight className="size-3.5 transition-transform group-hover:rotate-12" />
              </a>
            )}
            {socials.slice(0, 4).map((s) => (
              <a
                key={s.url}
                href={s.url}
                target="_blank"
                rel="noreferrer"
                className="px-4 py-2 rounded-full bg-white/[0.06] border border-white/[0.08] text-[13.5px] hover:bg-white/[0.10] hover:border-white/[0.14] transition-all"
              >
                {s.name}
              </a>
            ))}
          </div>
        </div>
      </div>

      <footer className="mt-10 text-[12px] font-mono text-neutral-500 flex items-baseline justify-between flex-wrap gap-2">
        <span>{name} · made on a quiet evening</span>
        <span className="inline-flex items-center gap-1.5">
          <Sparkles className="size-3" />
          Built with Glow
        </span>
      </footer>
    </motion.section>
  );
}

/* ─────────────────────────  Helpers  ────────────────────────── */

function stripMd(s: string): string {
  return s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*_`]/g, "");
}

function formatShort(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}
