/* eslint-disable @next/next/no-img-element */
"use client";

import Markdown from "react-markdown";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useResume, useHandle, useUrlPrefix } from "@/components/data-provider";
import { allSocials } from "@gitshow/shared/resume";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { LogoOrInitials } from "@/components/logo-or-initials";
import { resolveSkillIcon } from "@/components/skill-icons";
import { Icons } from "@/components/icons";
import { formatResumeDateRange } from "@/lib/format-date";
import { ArrowUpRight, Github, Linkedin, Mail, Twitter } from "lucide-react";

/**
 * Spotlight — the most cloned dev portfolio on the internet.
 *
 * Brittany Chiang v4 layout: sticky left identity column with name,
 * tagline, anchor nav, and socials; scrolling right column with the
 * actual content. A cursor-tracking radial spotlight follows the mouse
 * across the whole page. Active section's nav line expands when its
 * section enters the viewport.
 *
 * Best for: senior FE/full-stack engineers — the "I'm serious about
 * my craft" template.
 */

type NavItem = {
  id: string;
  label: string;
  check: (r: ReturnType<typeof useResume>, hidden: Set<string>) => boolean;
};

const NAV: NavItem[] = [
  { id: "about", label: "About", check: (_r, h) => !h.has("about") },
  { id: "experience", label: "Experience", check: (r, h) => !h.has("work") && r.work.length > 0 },
  { id: "projects", label: "Projects", check: (r, h) => !h.has("projects") && r.projects.length > 0 },
  {
    id: "writing",
    label: "Writing",
    check: (r, h) => (!h.has("publications") && r.publications.length > 0) || r.blog.length > 0,
  },
  {
    id: "more",
    label: "More",
    check: (r, h) =>
      (!h.has("skills") && r.skills.length > 0) ||
      (!h.has("education") && r.education.length > 0) ||
      (!h.has("hackathons") && r.hackathons.length > 0) ||
      (!h.has("buildLog") && r.buildLog.length > 0),
  },
];

export default function SpotlightTemplate() {
  const r = useResume();
  const handle = useHandle();
  const urlPrefix = useUrlPrefix();
  const hidden = new Set<string>(r.sections.hidden);
  const socials = allSocials(r);
  const visibleNav = NAV.filter((n) => n.check(r, hidden));
  const [active, setActive] = useState<string>(visibleNav[0]?.id ?? "about");
  const cursorRef = useRef<HTMLDivElement>(null);

  // Cursor-tracking spotlight — fixed div that follows the mouse with
  // a radial gradient. The whole page reads brighter under the cursor.
  useEffect(() => {
    const el = cursorRef.current;
    if (!el) return;
    let raf = 0;
    let pendingX = 0;
    let pendingY = 0;
    const onMove = (e: PointerEvent) => {
      pendingX = e.clientX;
      pendingY = e.clientY;
      if (!raf) {
        raf = requestAnimationFrame(() => {
          el.style.background = `radial-gradient(600px circle at ${pendingX}px ${pendingY}px, rgba(29, 78, 216, 0.10), transparent 40%)`;
          raf = 0;
        });
      }
    };
    window.addEventListener("pointermove", onMove);
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      className="min-h-dvh antialiased text-[#ccd6f6]"
      style={{ background: "#0a192f" }}
    >
      {/* Spotlight — fixed under content, blend-mode lifts only what's already light */}
      <div
        ref={cursorRef}
        aria-hidden
        className="pointer-events-none fixed inset-0 z-30"
      />

      {/* Subtle dot grid for depth */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(204, 214, 246, 0.04) 1px, transparent 0)",
          backgroundSize: "32px 32px",
        }}
      />

      <div className="relative z-10 mx-auto max-w-[1280px] px-6 sm:px-12 lg:px-20">
        <div className="lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
          {/* LEFT — sticky identity */}
          <SidePanel
            r={r}
            handle={handle}
            homeHref={urlPrefix || "/"}
            socials={hidden.has("contact") ? [] : socials}
            showContact={!hidden.has("contact")}
            visibleNav={visibleNav}
            active={active}
          />

          {/* RIGHT — scrolling content */}
          <main className="py-16 lg:py-24 space-y-24">
            {visibleNav.find((n) => n.id === "about") && (
              <SectionHost id="about" onView={setActive}>
                <About summary={r.person.summary} />
              </SectionHost>
            )}

            {visibleNav.find((n) => n.id === "experience") && !hidden.has("work") && r.work.length > 0 && (
              <SectionHost id="experience" onView={setActive}>
                <Experience work={r.work} />
              </SectionHost>
            )}

            {visibleNav.find((n) => n.id === "projects") && !hidden.has("projects") && r.projects.length > 0 && (
              <SectionHost id="projects" onView={setActive}>
                <Projects projects={r.projects.slice(0, 8)} />
              </SectionHost>
            )}

            {visibleNav.find((n) => n.id === "writing") && (!hidden.has("publications") || r.blog.length > 0) && (
              <SectionHost id="writing" onView={setActive}>
                <Writing
                  publications={hidden.has("publications") ? [] : r.publications}
                  blog={r.blog}
                />
              </SectionHost>
            )}

            {visibleNav.find((n) => n.id === "more") && (
              <SectionHost id="more" onView={setActive}>
                <More
                  education={hidden.has("education") ? [] : r.education}
                  hackathons={hidden.has("hackathons") ? [] : r.hackathons}
                  buildLog={hidden.has("buildLog") ? [] : r.buildLog}
                  skills={hidden.has("skills") ? [] : r.skills}
                />
              </SectionHost>
            )}

            {/* Footer signature */}
            <footer className="pt-12 border-t border-white/[0.06] text-[12.5px] text-[#8892b0] font-mono leading-relaxed">
              Built quietly in a code editor, set in Inter and JetBrains Mono.
              <br />
              Last edit · {formatShort(r.meta.updatedAt)}.
            </footer>
          </main>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────  Sticky identity panel  ────────────────────────── */

function SidePanel({
  r,
  handle,
  homeHref,
  socials,
  showContact,
  visibleNav,
  active,
}: {
  r: ReturnType<typeof useResume>;
  handle: string;
  /** Resolved home href — `/{handle}` on canonical, `/` on custom domain. */
  homeHref: string;
  socials: ReturnType<typeof allSocials>;
  showContact: boolean;
  visibleNav: typeof NAV;
  active: string;
}) {
  return (
    <aside className="lg:sticky lg:top-0 lg:flex lg:max-h-screen lg:flex-col lg:justify-between lg:py-24 py-16">
      <div>
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        >
          {/* Tiny avatar + handle row — restrained, not a header card */}
          <div className="flex items-center gap-3 mb-6">
            <Avatar className="size-10 ring-1 ring-white/10">
              <AvatarImage src={r.person.avatarUrl} alt={r.person.name} />
              <AvatarFallback className="bg-[#112240] text-[#64ffda] font-mono text-sm">
                {r.person.initials}
              </AvatarFallback>
            </Avatar>
            <a
              href={homeHref}
              className="text-[12px] font-mono text-[#8892b0] hover:text-[#64ffda] transition-colors"
            >
              @{handle}
            </a>
          </div>

          <h1
            className="text-[#e6f1ff] font-bold tracking-tight leading-[1.05]"
            style={{ fontSize: "clamp(40px, 6vw, 64px)" }}
          >
            {r.person.name}
          </h1>
          <h2
            className="text-[#ccd6f6] font-semibold tracking-tight mt-3"
            style={{ fontSize: "clamp(20px, 2.4vw, 28px)" }}
          >
            {topRole(r)}
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-[#8892b0] max-w-[28ch]">
            {r.person.description}
          </p>
          {r.person.location && (
            <p className="mt-4 text-[12.5px] text-[#8892b0] font-mono inline-flex items-center gap-2">
              <span aria-hidden className="size-1 rounded-full bg-[#64ffda]" />
              {r.person.location}
            </p>
          )}
        </motion.div>

        {/* Anchor nav */}
        <motion.nav
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15, ease: "easeOut" }}
          className="hidden lg:block mt-16"
          aria-label="Section navigation"
        >
          <ul className="space-y-3 font-mono text-[12px] uppercase tracking-[0.2em]">
            {visibleNav.map((n) => {
              const isActive = active === n.id;
              return (
                <li key={n.id}>
                  <a
                    href={`#${n.id}`}
                    className="group inline-flex items-center gap-4 py-1 transition-colors"
                    style={{ color: isActive ? "#e6f1ff" : "#8892b0" }}
                  >
                    <motion.span
                      aria-hidden
                      animate={{ width: isActive ? 64 : 24 }}
                      transition={{ duration: 0.25, ease: "easeOut" }}
                      className="block h-px"
                      style={{
                        background: isActive ? "#e6f1ff" : "#495670",
                      }}
                    />
                    <span className="group-hover:text-[#e6f1ff] transition-colors">
                      {n.label}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </motion.nav>
      </div>

      {/* Socials at bottom of viewport */}
      {showContact && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="hidden lg:flex items-center gap-5 mt-12 pt-12"
        >
          {socials.slice(0, 5).map((s) => (
            <a
              key={s.url}
              href={s.url}
              target="_blank"
              rel="noreferrer"
              aria-label={s.name}
              className="text-[#8892b0] hover:text-[#64ffda] hover:-translate-y-px transition-all"
            >
              <SocialIcon name={s.name} className="size-5" />
            </a>
          ))}
          {r.contact.email && (
            <a
              href={`mailto:${r.contact.email}`}
              aria-label="Email"
              className="text-[#8892b0] hover:text-[#64ffda] hover:-translate-y-px transition-all"
            >
              <Mail className="size-5" />
            </a>
          )}
        </motion.div>
      )}
    </aside>
  );
}

function SocialIcon({ name, className }: { name: string; className?: string }) {
  const n = name.toLowerCase();
  if (n.includes("github")) return <Github className={className} />;
  if (n.includes("linkedin")) return <Linkedin className={className} />;
  if (n.includes("twitter") || n === "x") return <Twitter className={className} />;
  // Fall through to project icon registry for the rest (IconSpec components)
  const Specific = (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[n];
  if (Specific) return <Specific className={className} />;
  return <ArrowUpRight className={className} />;
}

/* ─────────────────────────  Section host (intersection)  ────────────────────────── */

function SectionHost({
  id,
  onView,
  children,
}: {
  id: string;
  onView: (id: string) => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) onView(id);
        }
      },
      { rootMargin: "-40% 0px -55% 0px", threshold: 0 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [id, onView]);
  return (
    <section ref={ref} id={id} className="scroll-mt-24">
      {children}
    </section>
  );
}

/* ─────────────────────────  About  ────────────────────────── */

function About({ summary }: { summary: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.5, ease: "easeOut" }}
    >
      <SectionHeader number="01" label="About" />
      <article className="text-[15.5px] leading-[1.7] text-[#a8b2d1] [&_p]:mb-4 [&_p:last-child]:mb-0">
        <Markdown
          components={{
            a: ({ href, children }) => (
              <a
                href={href}
                className="text-[#64ffda] underline-offset-4 decoration-[#64ffda]/40 hover:decoration-[#64ffda] transition-colors"
              >
                {children}
              </a>
            ),
            strong: ({ children }) => (
              <strong className="text-[#e6f1ff] font-semibold">{children}</strong>
            ),
            em: ({ children }) => <em className="text-[#ccd6f6] italic">{children}</em>,
            code: ({ children }) => (
              <code className="text-[#64ffda] bg-[#112240] px-1.5 py-0.5 rounded text-[0.92em] font-mono">
                {children}
              </code>
            ),
          }}
        >
          {summary}
        </Markdown>
      </article>
    </motion.div>
  );
}

/* ─────────────────────────  Experience  ────────────────────────── */

function Experience({ work }: { work: ReturnType<typeof useResume>["work"] }) {
  return (
    <div>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.5, ease: "easeOut" }}
      >
        <SectionHeader number="02" label="Experience" />
      </motion.div>

      <ol className="space-y-3">
        {work.map((w, i) => (
          <motion.li
            key={w.id}
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.4, delay: i * 0.04, ease: "easeOut" }}
          >
            <a
              href={w.href ?? "#"}
              target={w.href ? "_blank" : undefined}
              rel="noreferrer"
              className="group relative grid grid-cols-1 sm:grid-cols-12 gap-3 sm:gap-6 rounded-xl p-4 sm:-mx-4 sm:p-5 hover:bg-[#112240]/40 transition-colors"
            >
              {/* Hover glow border */}
              <div
                aria-hidden
                className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity ring-1 ring-[#64ffda]/10 pointer-events-none"
              />
              <div className="sm:col-span-3 text-[11.5px] uppercase tracking-[0.18em] text-[#8892b0] font-mono pt-1 tabular-nums">
                {formatResumeDateRange(w.start, w.end)}
              </div>
              <div className="sm:col-span-9">
                <h3 className="font-semibold text-[#e6f1ff] text-[16px] inline-flex items-baseline gap-2 leading-tight">
                  <span className="group-hover:text-[#64ffda] transition-colors">
                    {w.title}
                  </span>
                  <span className="text-[#ccd6f6] font-medium">·</span>
                  <span className="text-[#ccd6f6] font-medium">{w.company}</span>
                  {w.href && (
                    <ArrowUpRight
                      aria-hidden
                      className="size-4 text-[#64ffda] opacity-0 -translate-x-1 -translate-y-1 group-hover:opacity-100 group-hover:translate-x-0 group-hover:translate-y-0 transition-all"
                    />
                  )}
                </h3>
                {w.location && (
                  <div className="text-[12px] font-mono text-[#8892b0] mt-0.5">
                    {w.location}
                  </div>
                )}
                {w.description && (
                  <div className="text-[14.5px] leading-[1.7] text-[#a8b2d1] mt-3 max-w-[60ch] [&_p]:mb-2 [&_ul]:list-none [&_ul]:space-y-1 [&_li]:pl-4 [&_li]:relative [&_li]:before:content-['▸'] [&_li]:before:absolute [&_li]:before:left-0 [&_li]:before:text-[#64ffda]">
                    <Markdown
                      components={{
                        a: ({ href, children }) => (
                          <a
                            href={href}
                            className="text-[#64ffda] underline-offset-4 decoration-[#64ffda]/40 hover:decoration-[#64ffda]"
                          >
                            {children}
                          </a>
                        ),
                      }}
                    >
                      {w.description}
                    </Markdown>
                  </div>
                )}
                {w.badges && w.badges.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {w.badges.map((b) => (
                      <span
                        key={b}
                        className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-[#64ffda]/10 text-[#64ffda]"
                      >
                        {b}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </a>
          </motion.li>
        ))}
      </ol>
    </div>
  );
}

/* ─────────────────────────  Projects  ────────────────────────── */

function Projects({
  projects,
}: {
  projects: ReturnType<typeof useResume>["projects"];
}) {
  return (
    <div>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.5, ease: "easeOut" }}
      >
        <SectionHeader number="03" label="Selected Projects" />
      </motion.div>

      <ol className="space-y-7">
        {projects.map((p, i) => (
          <motion.li
            key={p.id}
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.45, delay: i * 0.04, ease: "easeOut" }}
          >
            <a
              href={p.href ?? "#"}
              target="_blank"
              rel="noreferrer"
              className="group relative block rounded-2xl p-4 sm:p-5 -mx-4 sm:-mx-5 transition-all hover:bg-[#112240]/40"
            >
              {/* Subtle hover ring */}
              <div
                aria-hidden
                className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity ring-1 ring-[#64ffda]/15 pointer-events-none"
              />

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 sm:gap-6 items-start">
                {/* Image — clean, no overlay veil. Just sits on the left. */}
                <div className="sm:col-span-4">
                  <div className="relative aspect-[16/10] overflow-hidden rounded-md border border-[#233554]/40 bg-[#112240]">
                    {p.video ? (
                      <video
                        src={p.video}
                        muted
                        loop
                        playsInline
                        autoPlay
                        className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
                      />
                    ) : p.image ? (
                      <img
                        src={p.image}
                        alt={p.title}
                        className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
                      />
                    ) : (
                      <div className="absolute inset-0 bg-gradient-to-br from-[#112240] to-[#1d3a5f] flex items-center justify-center">
                        <span className="font-mono text-[#64ffda]/60 text-[11px] tracking-wider uppercase">
                          {p.title.slice(0, 2)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Content — clean column to the right */}
                <div className="sm:col-span-8">
                  <div className="flex items-baseline gap-2 mb-1.5 flex-wrap">
                    <span className="text-[10.5px] font-mono uppercase tracking-[0.22em] text-[#64ffda]">
                      {p.dates}
                    </span>
                    {p.active && (
                      <span className="text-[10.5px] font-mono uppercase tracking-[0.22em] text-emerald-400 inline-flex items-center gap-1">
                        <span
                          aria-hidden
                          className="size-1 rounded-full bg-emerald-400 animate-pulse"
                        />
                        live
                      </span>
                    )}
                  </div>
                  <h3 className="text-xl font-semibold text-[#e6f1ff] leading-tight inline-flex items-baseline gap-2 group-hover:text-[#64ffda] transition-colors">
                    {p.title}
                    <ArrowUpRight
                      aria-hidden
                      className="size-4 -translate-y-0.5 transition-transform group-hover:rotate-12 group-hover:translate-y-0"
                    />
                  </h3>
                  <div className="mt-2 text-[14.5px] leading-[1.7] text-[#a8b2d1] [&_p]:mb-2 [&_p:last-child]:mb-0 max-w-[60ch]">
                    <Markdown
                      components={{
                        a: ({ href, children }) => (
                          <a
                            href={href}
                            className="text-[#64ffda] underline-offset-4 decoration-[#64ffda]/40 hover:decoration-[#64ffda]"
                          >
                            {children}
                          </a>
                        ),
                      }}
                    >
                      {p.description}
                    </Markdown>
                  </div>
                  {p.technologies.length > 0 && (
                    <ul className="flex flex-wrap gap-1.5 mt-3">
                      {p.technologies.slice(0, 6).map((t) => (
                        <li
                          key={t}
                          className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-[#64ffda]/[0.08] text-[#64ffda]"
                        >
                          {t}
                        </li>
                      ))}
                    </ul>
                  )}
                  {p.links && p.links.length > 0 && (
                    <ul className="flex items-center gap-1.5 mt-3 flex-wrap">
                      {p.links.slice(0, 3).map((l) => (
                        <li key={l.href}>
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              window.open(l.href, "_blank", "noreferrer");
                            }}
                            className="cursor-pointer text-[11.5px] font-mono inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-[#233554]/60 text-[#a8b2d1] hover:border-[#64ffda]/40 hover:text-[#64ffda] transition-colors"
                          >
                            {l.label}
                            <ArrowUpRight aria-hidden className="size-3" />
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </a>
          </motion.li>
        ))}
      </ol>
    </div>
  );
}

/* ─────────────────────────  Writing  ────────────────────────── */

function Writing({
  publications,
  blog,
}: {
  publications: ReturnType<typeof useResume>["publications"];
  blog: ReturnType<typeof useResume>["blog"];
}) {
  if (publications.length === 0 && blog.length === 0) return null;
  return (
    <div>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.5, ease: "easeOut" }}
      >
        <SectionHeader number="04" label="Writing & Talks" />
      </motion.div>

      <ol className="space-y-2">
        {publications.map((p, i) => (
          <motion.li
            key={p.id}
            initial={{ opacity: 0, y: 6 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.35, delay: i * 0.04, ease: "easeOut" }}
          >
            <a
              href={p.url}
              target="_blank"
              rel="noreferrer"
              className="group grid grid-cols-1 sm:grid-cols-12 gap-2 sm:gap-6 -mx-3 px-3 py-3 rounded-lg hover:bg-[#112240]/40 transition-colors"
            >
              <div className="sm:col-span-2 text-[11.5px] font-mono text-[#64ffda] uppercase tracking-wider pt-0.5">
                {p.kind}
              </div>
              <div className="sm:col-span-8">
                <div className="text-[#e6f1ff] font-medium leading-tight inline-flex items-baseline gap-1.5 group-hover:text-[#64ffda] transition-colors">
                  {p.title}
                  <ArrowUpRight className="size-3.5 opacity-0 -translate-x-1 -translate-y-1 group-hover:opacity-100 group-hover:translate-x-0 group-hover:translate-y-0 transition-all" />
                </div>
                {p.venue && (
                  <div className="text-[12.5px] text-[#8892b0] italic mt-0.5">
                    {p.venue}
                  </div>
                )}
              </div>
              <div className="sm:col-span-2 text-[11.5px] font-mono text-[#8892b0] tabular-nums sm:text-right">
                {p.publishedAt}
              </div>
            </a>
          </motion.li>
        ))}
        {blog.slice(0, 6).map((b, i) => (
          <motion.li
            key={b.slug}
            initial={{ opacity: 0, y: 6 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.35, delay: (publications.length + i) * 0.04, ease: "easeOut" }}
          >
            <a
              href={b.sourceUrl ?? "#"}
              target="_blank"
              rel="noreferrer"
              className="group grid grid-cols-1 sm:grid-cols-12 gap-2 sm:gap-6 -mx-3 px-3 py-3 rounded-lg hover:bg-[#112240]/40 transition-colors"
            >
              <div className="sm:col-span-2 text-[11.5px] font-mono text-[#64ffda] uppercase tracking-wider pt-0.5">
                Blog
              </div>
              <div className="sm:col-span-8">
                <div className="text-[#e6f1ff] font-medium leading-tight inline-flex items-baseline gap-1.5 group-hover:text-[#64ffda] transition-colors">
                  {b.title}
                  <ArrowUpRight className="size-3.5 opacity-0 -translate-x-1 -translate-y-1 group-hover:opacity-100 group-hover:translate-x-0 group-hover:translate-y-0 transition-all" />
                </div>
                {b.summary && (
                  <div className="text-[12.5px] text-[#8892b0] mt-0.5 line-clamp-1">
                    {b.summary}
                  </div>
                )}
              </div>
              <div className="sm:col-span-2 text-[11.5px] font-mono text-[#8892b0] tabular-nums sm:text-right">
                {formatShort(b.publishedAt)}
              </div>
            </a>
          </motion.li>
        ))}
      </ol>
    </div>
  );
}

/* ─────────────────────────  More — small grid of micro-sections  ────────────────────────── */

function More({
  education,
  hackathons,
  buildLog,
  skills,
}: {
  education: ReturnType<typeof useResume>["education"];
  hackathons: ReturnType<typeof useResume>["hackathons"];
  buildLog: ReturnType<typeof useResume>["buildLog"];
  skills: ReturnType<typeof useResume>["skills"];
}) {
  return (
    <div>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.5, ease: "easeOut" }}
      >
        <SectionHeader number="05" label="More" />
      </motion.div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-12">
        {skills.length > 0 && (
          <div>
            <SubHeader>Toolbox</SubHeader>
            <ul className="flex flex-wrap gap-1.5 mt-3">
              {skills.slice(0, 24).map((s) => {
                const Icon = resolveSkillIcon(s.iconKey ?? s.name);
                return (
                  <li
                    key={s.name}
                    className="inline-flex items-center gap-1.5 text-[12px] font-mono px-2 py-0.5 rounded-md bg-[#112240]/60 text-[#a8b2d1] border border-white/[0.04] hover:border-[#64ffda]/30 hover:text-[#64ffda] transition-colors"
                  >
                    {Icon && <Icon className="size-3" />}
                    {s.name}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {education.length > 0 && (
          <div>
            <SubHeader>Education</SubHeader>
            <ul className="mt-3 space-y-3">
              {education.map((e) => (
                <li key={e.id} className="flex items-start gap-3">
                  <LogoOrInitials src={e.logoUrl} name={e.school} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-medium text-[#e6f1ff] truncate">
                      {e.school}
                    </div>
                    <div className="text-[12.5px] text-[#a8b2d1] line-clamp-2">
                      {e.degree}
                    </div>
                    <div className="text-[11.5px] text-[#8892b0] font-mono tabular-nums mt-0.5">
                      {formatResumeDateRange(e.start, e.end)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {hackathons.length > 0 && (
          <div>
            <SubHeader>Hackathons</SubHeader>
            <ul className="mt-3 space-y-3">
              {hackathons.slice(0, 5).map((h) => (
                <li key={h.id} className="border-l border-[#64ffda]/30 pl-3">
                  <div className="text-[14px] font-medium text-[#e6f1ff] leading-tight">
                    {h.title}
                  </div>
                  {h.rank && (
                    <div className="text-[12px] text-[#64ffda] mt-0.5">★ {h.rank}</div>
                  )}
                  {h.date && (
                    <div className="text-[11.5px] text-[#8892b0] font-mono mt-0.5">
                      {h.date}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {buildLog.length > 0 && (
          <div>
            <SubHeader>Recently shipping</SubHeader>
            <ul className="mt-3 space-y-2">
              {buildLog.slice(0, 6).map((b) => (
                <li key={b.id} className="flex items-baseline gap-2 text-[13px]">
                  <span
                    aria-hidden
                    className="size-1.5 rounded-full flex-none translate-y-[5px]"
                    style={{ backgroundColor: b.languageColor ?? "#64ffda" }}
                  />
                  <div className="min-w-0">
                    <span className="text-[#e6f1ff] font-medium">{b.title}</span>
                    <span className="text-[#8892b0]"> — {b.description}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────  Section primitives  ────────────────────────── */

function SectionHeader({
  number,
  label,
}: {
  number: string;
  label: string;
}) {
  return (
    <header className="flex items-center gap-3 mb-8 lg:hidden">
      <span className="text-[#64ffda] font-mono text-[14px]">
        <span className="opacity-70">{number}.</span>
      </span>
      <h2 className="text-[#e6f1ff] font-bold text-xl">{label}</h2>
      <span aria-hidden className="flex-1 h-px bg-[#233554]" />
    </header>
  );
}

function SubHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-mono uppercase tracking-[0.22em] text-[#64ffda]">
      {children}
    </h3>
  );
}

/* ─────────────────────────  Helpers  ────────────────────────── */

function topRole(r: ReturnType<typeof useResume>): string {
  const w = r.work[0];
  if (w) return `${w.title} at ${w.company}.`;
  if (r.person.description) return r.person.description.split(/[.!?]/)[0] + ".";
  return "Engineer.";
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
