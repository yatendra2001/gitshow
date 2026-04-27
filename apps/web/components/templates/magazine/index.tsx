/* eslint-disable @next/next/no-img-element */
"use client";

import Markdown from "react-markdown";
import { useResume, useHandle } from "@/components/data-provider";
import { allSocials } from "@gitshow/shared/resume";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { LogoOrInitials } from "@/components/logo-or-initials";

/**
 * Magazine — editorial portfolio.
 *
 * Big serif type, drop cap on the about section, multi-column metadata,
 * generous whitespace, and a paper-toned palette. Reads like a feature
 * piece, not a CV. Best for founders, writers, designers, and engineers
 * with a story to tell.
 */
export default function MagazineTemplate() {
  const r = useResume();
  const handle = useHandle();
  const hidden = new Set(r.sections.hidden);
  const socials = allSocials(r);
  const firstName = r.person.name.split(" ")[0] ?? r.person.name;
  const issue = formatIssue(r.meta.updatedAt);

  return (
    <div className="min-h-dvh bg-[#f8f5ee] text-[#171717] [font-feature-settings:'liga','dlig','onum']">
      <div className="mx-auto max-w-5xl px-6 py-12 sm:px-10 sm:py-16">
        {/* Masthead */}
        <header className="border-b border-black/80 pb-4 mb-12 flex items-baseline justify-between gap-4 flex-wrap">
          <div className="text-[11px] tracking-[0.3em] uppercase font-semibold">
            The {firstName} Quarterly
          </div>
          <div className="text-[11px] tracking-[0.2em] uppercase text-[#5a5046]">
            {issue} · @{handle}
          </div>
        </header>

        {/* Hero — feature title */}
        <section className="grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-10 mb-20">
          <div className="md:col-span-8">
            <div className="text-[11px] tracking-[0.3em] uppercase text-[#b53f24] font-semibold mb-4">
              Profile · {r.person.location ?? "Currently building"}
            </div>
            <h1 className="font-serif text-5xl sm:text-7xl leading-[0.95] tracking-tight">
              {r.person.name}
            </h1>
            <p className="font-serif text-2xl sm:text-3xl leading-snug mt-6 text-[#3a342d] italic">
              “{r.person.description}”
            </p>
          </div>
          {r.person.avatarUrl && (
            <div className="md:col-span-4 flex md:justify-end">
              <div className="relative">
                <Avatar className="size-40 sm:size-48 rounded-none border border-black/80 shadow-[8px_8px_0_0_rgba(0,0,0,0.15)] [&_img]:rounded-none">
                  <AvatarImage src={r.person.avatarUrl} alt={r.person.name} className="object-cover" />
                  <AvatarFallback className="rounded-none bg-[#e9e1d2] text-[#171717] font-serif">
                    {r.person.initials}
                  </AvatarFallback>
                </Avatar>
                <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-[#b53f24] text-white text-[10px] tracking-[0.25em] uppercase font-semibold px-3 py-1">
                  Featured
                </div>
              </div>
            </div>
          )}
        </section>

        {/* About — drop cap, two-column on desktop */}
        <FeatureSection eyebrow="Letter from the desk" title="On craft, lately">
          <div className="md:columns-2 md:gap-10 [&_p]:mb-4 first-letter:font-serif first-letter:text-7xl first-letter:leading-[0.85] first-letter:float-left first-letter:mr-2 first-letter:mt-1 first-letter:text-[#b53f24] text-[16.5px] leading-[1.7] text-[#2a241d]">
            <Markdown
              components={{
                p: ({ children }) => <p>{children}</p>,
                a: ({ href, children }) => (
                  <a href={href} className="text-[#b53f24] underline-offset-4 hover:underline">
                    {children}
                  </a>
                ),
              }}
            >
              {r.person.summary}
            </Markdown>
          </div>
        </FeatureSection>

        {/* Work */}
        {!hidden.has("work") && r.work.length > 0 && (
          <FeatureSection eyebrow="Career" title="The notable engagements">
            <ol className="space-y-10">
              {r.work.map((w, i) => (
                <li key={w.id} className="grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-8 border-t border-black/15 pt-8 first:border-t-0 first:pt-0">
                  <div className="md:col-span-3 text-[12px] tracking-[0.15em] uppercase text-[#5a5046] font-semibold tabular-nums">
                    No. {String(i + 1).padStart(2, "0")} · {w.start} – {w.end}
                  </div>
                  <div className="md:col-span-9">
                    <div className="flex items-baseline gap-3 flex-wrap">
                      <LogoOrInitials src={w.logoUrl} name={w.company} />
                      <h3 className="font-serif text-2xl sm:text-3xl leading-tight">
                        <span className="text-[#b53f24]">{w.title}</span>
                        <span className="text-[#5a5046]"> at </span>
                        {w.company}
                      </h3>
                    </div>
                    {w.location && (
                      <div className="text-[12px] tracking-wide text-[#5a5046] mt-1 italic">
                        {w.location}
                      </div>
                    )}
                    {w.description && (
                      <div className="prose mt-4 text-[15.5px] leading-[1.75] text-[#2a241d] max-w-prose [&_p]:mb-3">
                        <Markdown
                          components={{
                            a: ({ href, children }) => (
                              <a href={href} className="text-[#b53f24] underline-offset-4 hover:underline">{children}</a>
                            ),
                          }}
                        >
                          {w.description}
                        </Markdown>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </FeatureSection>
        )}

        {/* Projects — magazine grid */}
        {!hidden.has("projects") && r.projects.length > 0 && (
          <FeatureSection eyebrow="Selected works" title="The portfolio">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-12">
              {r.projects.slice(0, 8).map((p) => (
                <article key={p.id} className="group">
                  {(p.image || p.video) && (
                    <a href={p.href ?? "#"} target="_blank" rel="noreferrer" className="block aspect-[4/3] mb-4 overflow-hidden border border-black/15 bg-[#e9e1d2]">
                      {p.video ? (
                        <video src={p.video} muted loop playsInline autoPlay className="w-full h-full object-cover" />
                      ) : (
                        <img src={p.image} alt={p.title} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
                      )}
                    </a>
                  )}
                  <div className="text-[11px] tracking-[0.25em] uppercase text-[#b53f24] font-semibold mb-1">
                    {p.dates}
                  </div>
                  <h3 className="font-serif text-2xl leading-tight mb-2">
                    <a href={p.href ?? "#"} target="_blank" rel="noreferrer" className="hover:text-[#b53f24] transition-colors">
                      {p.title}
                    </a>
                  </h3>
                  <div className="text-[14.5px] leading-[1.7] text-[#3a342d] [&_p]:mb-2">
                    <Markdown
                      components={{
                        a: ({ href, children }) => (
                          <a href={href} className="text-[#b53f24] underline-offset-4 hover:underline">{children}</a>
                        ),
                      }}
                    >
                      {p.description}
                    </Markdown>
                  </div>
                  {p.technologies.length > 0 && (
                    <div className="text-[11.5px] tracking-wide text-[#5a5046] mt-3 italic">
                      {p.technologies.join(" · ")}
                    </div>
                  )}
                </article>
              ))}
            </div>
          </FeatureSection>
        )}

        {/* Skills + education sidebars */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-10 mt-20">
          {r.skills.length > 0 && (
            <div className="md:col-span-7">
              <FeatureSection eyebrow="Toolbox" title="The instrumentation" tight>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 text-[14.5px] text-[#2a241d]">
                  {r.skills.map((s) => (
                    <div key={s.name} className="border-b border-black/10 pb-1 flex items-baseline justify-between gap-2">
                      <span>{s.name}</span>
                      {s.usageCount && (
                        <span className="text-[#5a5046] tabular-nums text-[12px]">×{s.usageCount}</span>
                      )}
                    </div>
                  ))}
                </div>
              </FeatureSection>
            </div>
          )}
          {!hidden.has("education") && r.education.length > 0 && (
            <div className="md:col-span-5">
              <FeatureSection eyebrow="Education" title="The schooling" tight>
                <ul className="space-y-4">
                  {r.education.map((e) => (
                    <li key={e.id} className="border-t border-black/15 pt-3 first:border-t-0 first:pt-0">
                      <div className="font-serif text-xl leading-tight">{e.school}</div>
                      <div className="text-[14px] text-[#3a342d] italic">{e.degree}</div>
                      <div className="text-[11.5px] tracking-wide uppercase text-[#5a5046] mt-1 tabular-nums">
                        {e.start} – {e.end}
                      </div>
                    </li>
                  ))}
                </ul>
              </FeatureSection>
            </div>
          )}
        </div>

        {/* Publications */}
        {!hidden.has("publications") && r.publications.length > 0 && (
          <FeatureSection eyebrow="In print" title="Publications & talks">
            <ul className="space-y-5">
              {r.publications.map((p) => (
                <li key={p.id} className="grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-8 border-t border-black/15 pt-4 first:border-t-0 first:pt-0">
                  <div className="md:col-span-3 text-[11.5px] tracking-[0.2em] uppercase text-[#5a5046] font-semibold">
                    {p.kind}{p.publishedAt ? ` · ${p.publishedAt}` : ""}
                  </div>
                  <div className="md:col-span-9">
                    <a href={p.url} target="_blank" rel="noreferrer" className="font-serif text-xl leading-snug hover:text-[#b53f24]">
                      {p.title}
                    </a>
                    {p.venue && <div className="text-[14px] italic text-[#3a342d] mt-1">{p.venue}</div>}
                    {p.summary && <div className="text-[14.5px] leading-[1.65] text-[#3a342d] mt-2">{p.summary}</div>}
                  </div>
                </li>
              ))}
            </ul>
          </FeatureSection>
        )}

        {/* Footer / colophon */}
        <footer className="mt-24 pt-8 border-t border-black/80 grid grid-cols-1 md:grid-cols-2 gap-8 text-[12.5px]">
          <div>
            <div className="text-[11px] tracking-[0.3em] uppercase font-semibold mb-2">Colophon</div>
            <p className="text-[#3a342d] leading-relaxed max-w-md">
              Set in a magazine layout for the modern engineer. The same data,
              presented as a feature piece. Curated by gitshow.
            </p>
          </div>
          <div className="md:text-right">
            <div className="text-[11px] tracking-[0.3em] uppercase font-semibold mb-2">Correspondence</div>
            <ul className="space-y-1">
              {r.contact.email && (
                <li>
                  <a href={`mailto:${r.contact.email}`} className="hover:text-[#b53f24]">
                    {r.contact.email}
                  </a>
                </li>
              )}
              {socials.map((s) => (
                <li key={s.url}>
                  <a href={s.url} target="_blank" rel="noreferrer" className="hover:text-[#b53f24]">
                    {s.name} →
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </footer>
      </div>
    </div>
  );
}

function FeatureSection({
  eyebrow,
  title,
  children,
  tight = false,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
  tight?: boolean;
}) {
  return (
    <section className={tight ? "mt-0" : "mt-20"}>
      <div className="text-[11px] tracking-[0.3em] uppercase text-[#b53f24] font-semibold mb-2">
        {eyebrow}
      </div>
      <h2 className="font-serif text-3xl sm:text-4xl leading-tight mb-6 border-b border-black/80 pb-3">
        {title}
      </h2>
      {children}
    </section>
  );
}

function formatIssue(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "Issue 01";
    const month = d.toLocaleString("en-US", { month: "long" });
    return `${month} ${d.getFullYear()}`;
  } catch {
    return "Issue 01";
  }
}
