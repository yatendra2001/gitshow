/* eslint-disable @next/next/no-img-element */
"use client";

import Markdown from "react-markdown";
import { useResume, useHandle } from "@/components/data-provider";
import { allSocials } from "@gitshow/shared/resume";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { LogoOrInitials } from "@/components/logo-or-initials";
import { resolveSkillIcon } from "@/components/skill-icons";
import { ArrowUpRight } from "lucide-react";

/**
 * Bento — Apple-style bento grid.
 *
 * Sections become cards of varied sizes that tile together. Cards have
 * a soft glassy surface with a subtle border. Hero card spans two
 * columns; smaller facets sit alongside. Perfect for full-stack devs
 * and visual thinkers who want everything visible at a glance.
 */
export default function BentoTemplate() {
  const r = useResume();
  const handle = useHandle();
  const hidden = new Set(r.sections.hidden);
  const socials = allSocials(r);
  const topProjects = r.projects.slice(0, 4);
  const featuredProject = topProjects[0];
  const otherProjects = topProjects.slice(1);

  return (
    <div className="min-h-dvh bg-[#070708] text-neutral-100 selection:bg-violet-400/30">
      {/* Soft gradient background */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute inset-x-0 top-0 h-[600px] bg-[radial-gradient(ellipse_at_top,rgba(167,139,250,0.18),transparent_60%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,rgba(56,189,248,0.10),transparent_60%)]" />
      </div>

      <div className="relative z-10 mx-auto max-w-6xl px-4 py-10 sm:px-8 sm:py-14">
        {/* Top bar */}
        <header className="flex items-center justify-between mb-6">
          <span className="text-[12px] tracking-wide text-neutral-500">@{handle}</span>
          <nav className="flex items-center gap-2 text-[12px] text-neutral-300">
            {socials.slice(0, 4).map((s) => (
              <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="px-2.5 py-1 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 transition-colors">
                {s.name}
              </a>
            ))}
          </nav>
        </header>

        {/* Bento grid */}
        <div className="grid grid-cols-12 gap-3 sm:gap-4 auto-rows-[140px]">
          {/* Hero — large */}
          <Card className="col-span-12 md:col-span-8 row-span-3 p-7 sm:p-9 flex flex-col justify-between bg-gradient-to-br from-violet-500/15 via-fuchsia-500/8 to-transparent" tone="bright">
            <div>
              <div className="text-[11px] tracking-[0.25em] uppercase text-violet-300 font-semibold mb-3">
                Hello there
              </div>
              <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight leading-[1.05]">
                I'm <span className="bg-gradient-to-r from-violet-200 to-violet-400 bg-clip-text text-transparent">{r.person.name}</span>.
              </h1>
              <p className="mt-4 text-lg text-neutral-300 max-w-2xl leading-snug">
                {r.person.description}
              </p>
            </div>
            <div className="flex items-center justify-between mt-6">
              <div className="text-[12.5px] text-neutral-400">
                {r.person.location && <span>📍 {r.person.location}</span>}
              </div>
              {r.contact.email && (
                <a href={`mailto:${r.contact.email}`} className="text-[13px] text-violet-300 hover:text-violet-200 inline-flex items-center gap-1">
                  Get in touch <ArrowUpRight className="size-3.5" />
                </a>
              )}
            </div>
          </Card>

          {/* Avatar */}
          <Card className="col-span-6 md:col-span-4 row-span-2 p-0 overflow-hidden">
            {r.person.avatarUrl ? (
              <div className="relative w-full h-full">
                <img
                  src={r.person.avatarUrl}
                  alt={r.person.name}
                  className="absolute inset-0 w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                <div className="absolute bottom-3 left-4 right-4">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-neutral-300">Currently</div>
                  <div className="text-sm text-white font-medium">{r.work[0]?.company ?? "Building"}</div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center w-full h-full">
                <Avatar className="size-32">
                  <AvatarFallback className="text-3xl font-semibold">{r.person.initials}</AvatarFallback>
                </Avatar>
              </div>
            )}
          </Card>

          {/* Stats — counts */}
          <Card className="col-span-6 md:col-span-2 row-span-1 p-4 flex flex-col justify-center">
            <div className="text-3xl font-semibold tabular-nums">{r.projects.length}</div>
            <div className="text-[11.5px] uppercase tracking-wide text-neutral-400">Projects</div>
          </Card>
          <Card className="col-span-6 md:col-span-2 row-span-1 p-4 flex flex-col justify-center">
            <div className="text-3xl font-semibold tabular-nums">{r.skills.length}</div>
            <div className="text-[11.5px] uppercase tracking-wide text-neutral-400">Skills</div>
          </Card>

          {/* About */}
          <Card className="col-span-12 md:col-span-7 row-span-3 p-6 sm:p-7">
            <CardLabel>About</CardLabel>
            <div className="prose prose-invert max-w-none text-[14.5px] leading-relaxed text-neutral-300 [&_p]:mb-3 [&_a]:text-violet-300 [&_a]:underline-offset-2 hover:[&_a]:underline overflow-hidden">
              <Markdown>{r.person.summary}</Markdown>
            </div>
          </Card>

          {/* Featured project */}
          {featuredProject && (
            <Card className="col-span-12 md:col-span-5 row-span-3 p-0 overflow-hidden group">
              <a href={featuredProject.href ?? "#"} target="_blank" rel="noreferrer" className="block w-full h-full relative">
                {featuredProject.video ? (
                  <video src={featuredProject.video} muted loop playsInline autoPlay className="absolute inset-0 w-full h-full object-cover" />
                ) : featuredProject.image ? (
                  <img src={featuredProject.image} alt={featuredProject.title} className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.04]" />
                ) : (
                  <div className="absolute inset-0 bg-gradient-to-br from-violet-500/30 to-cyan-500/20" />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 p-6">
                  <CardLabel className="text-violet-200 mb-1">Featured</CardLabel>
                  <h3 className="text-2xl font-semibold mb-1">{featuredProject.title}</h3>
                  <p className="text-[13.5px] text-neutral-200 line-clamp-2">{featuredProject.description}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {featuredProject.technologies.slice(0, 4).map((t) => (
                      <span key={t} className="text-[11px] px-2 py-0.5 rounded-full bg-white/15 text-white">{t}</span>
                    ))}
                  </div>
                </div>
              </a>
            </Card>
          )}

          {/* Skills cloud */}
          {r.skills.length > 0 && (
            <Card className="col-span-12 md:col-span-7 row-span-2 p-6">
              <CardLabel>Toolbox</CardLabel>
              <div className="flex flex-wrap gap-1.5">
                {r.skills.map((s) => {
                  const Icon = resolveSkillIcon(s.iconKey ?? s.name);
                  return (
                    <span key={s.name} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-[12.5px] text-neutral-200">
                      {Icon && <Icon className="size-3.5" />}
                      {s.name}
                    </span>
                  );
                })}
              </div>
            </Card>
          )}

          {/* Now / Currently */}
          {r.work[0] && (
            <Card className="col-span-12 md:col-span-5 row-span-2 p-6 bg-gradient-to-br from-cyan-500/10 to-transparent">
              <CardLabel className="text-cyan-300">Currently</CardLabel>
              <div className="flex items-start gap-3">
                <LogoOrInitials src={r.work[0].logoUrl} name={r.work[0].company} />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-base">{r.work[0].title}</div>
                  <div className="text-[13px] text-neutral-300">{r.work[0].company}</div>
                  <div className="text-[11.5px] text-neutral-500 mt-0.5">{r.work[0].start} – {r.work[0].end}</div>
                </div>
              </div>
            </Card>
          )}

          {/* Other projects */}
          {otherProjects.map((p) => (
            <Card key={p.id} className="col-span-12 md:col-span-4 row-span-2 p-0 overflow-hidden group">
              <a href={p.href ?? "#"} target="_blank" rel="noreferrer" className="block w-full h-full relative">
                {p.image && (
                  <img src={p.image} alt={p.title} className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 p-4">
                  <h4 className="font-semibold text-white text-base">{p.title}</h4>
                  <p className="text-[12px] text-neutral-300 line-clamp-2 mt-0.5">{p.description}</p>
                </div>
              </a>
            </Card>
          ))}

          {/* Work timeline */}
          {!hidden.has("work") && r.work.length > 0 && (
            <Card className="col-span-12 md:col-span-7 row-span-3 p-6">
              <CardLabel>Career timeline</CardLabel>
              <ol className="space-y-3.5">
                {r.work.slice(0, 5).map((w) => (
                  <li key={w.id} className="flex items-start gap-3">
                    <LogoOrInitials src={w.logoUrl} name={w.company} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-[14px]">{w.title} <span className="text-neutral-500">·</span> <span className="text-neutral-300">{w.company}</span></div>
                      <div className="text-[11.5px] text-neutral-500 tabular-nums">{w.start} – {w.end}</div>
                    </div>
                  </li>
                ))}
              </ol>
            </Card>
          )}

          {/* Education */}
          {!hidden.has("education") && r.education.length > 0 && (
            <Card className="col-span-12 md:col-span-5 row-span-3 p-6">
              <CardLabel>Education</CardLabel>
              <ul className="space-y-3">
                {r.education.map((e) => (
                  <li key={e.id} className="flex items-start gap-3">
                    <LogoOrInitials src={e.logoUrl} name={e.school} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-[14px]">{e.school}</div>
                      <div className="text-[12.5px] text-neutral-400">{e.degree}</div>
                      <div className="text-[11.5px] text-neutral-500 tabular-nums">{e.start} – {e.end}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* Hackathons / publications strip */}
          {!hidden.has("hackathons") && r.hackathons.length > 0 && (
            <Card className="col-span-12 md:col-span-6 row-span-2 p-6">
              <CardLabel>Hackathons</CardLabel>
              <ul className="space-y-2 text-[13.5px]">
                {r.hackathons.slice(0, 4).map((h) => (
                  <li key={h.id} className="flex items-baseline justify-between gap-2">
                    <span className="text-neutral-200 font-medium truncate">{h.title}</span>
                    <span className="text-neutral-500 text-[11.5px] tabular-nums flex-none">{h.date}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {!hidden.has("publications") && r.publications.length > 0 && (
            <Card className="col-span-12 md:col-span-6 row-span-2 p-6">
              <CardLabel>Publications</CardLabel>
              <ul className="space-y-2 text-[13.5px]">
                {r.publications.slice(0, 4).map((p) => (
                  <li key={p.id}>
                    <a href={p.url} target="_blank" rel="noreferrer" className="text-neutral-100 hover:text-violet-300">
                      {p.title}
                    </a>
                    {p.venue && <div className="text-[11.5px] text-neutral-500">{p.venue}</div>}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* Contact CTA */}
          <Card className="col-span-12 row-span-2 p-7 bg-gradient-to-br from-violet-500/15 via-transparent to-cyan-500/10 flex items-center justify-between flex-wrap gap-4">
            <div>
              <div className="text-2xl sm:text-3xl font-semibold">Let's build something.</div>
              <div className="text-neutral-400 text-[14px]">I'm reachable, and I read every email.</div>
            </div>
            <div className="flex flex-wrap gap-2">
              {r.contact.email && (
                <a href={`mailto:${r.contact.email}`} className="px-4 py-2 rounded-full bg-white text-black font-medium text-[14px] hover:bg-neutral-200 transition-colors">
                  Email me
                </a>
              )}
              {socials.slice(0, 3).map((s) => (
                <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="px-4 py-2 rounded-full bg-white/10 border border-white/10 text-[14px] hover:bg-white/15">
                  {s.name}
                </a>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Card({
  children,
  className = "",
  tone = "default",
}: {
  children: React.ReactNode;
  className?: string;
  tone?: "default" | "bright";
}) {
  return (
    <div
      className={`relative rounded-2xl bg-white/[0.035] border border-white/10 backdrop-blur-sm shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset] overflow-hidden ${tone === "bright" ? "ring-1 ring-white/5" : ""} ${className}`}
    >
      {children}
    </div>
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
    <div className={`text-[10.5px] tracking-[0.22em] uppercase text-neutral-400 font-semibold mb-3 ${className}`}>
      {children}
    </div>
  );
}
