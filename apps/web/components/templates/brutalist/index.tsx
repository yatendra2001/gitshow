/* eslint-disable @next/next/no-img-element */
"use client";

import Markdown from "react-markdown";
import { useResume, useHandle } from "@/components/data-provider";
import { allSocials } from "@gitshow/shared/resume";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ArrowUpRight } from "lucide-react";

/**
 * Brutalist — high-contrast, asymmetric, unapologetic.
 *
 * Big block type, raw monochrome on warm-paper background, sharp red
 * accents. Uses asymmetric 12-column grids, mismatched type, and bold
 * dividers. For creative engineers and designers who want to be
 * remembered after one scroll.
 */
export default function BrutalistTemplate() {
  const r = useResume();
  const handle = useHandle();
  const hidden = new Set(r.sections.hidden);
  const socials = allSocials(r);

  return (
    <div className="min-h-dvh bg-[#fafafa] text-black [font-feature-settings:'liga','dlig']">
      {/* Marquee header */}
      <div className="border-b-[3px] border-black overflow-hidden">
        <div className="flex whitespace-nowrap py-2 text-[12px] tracking-[0.3em] uppercase font-bold animate-[brutal-marquee_30s_linear_infinite]">
          {Array.from({ length: 8 }).map((_, i) => (
            <span key={i} className="px-6 flex items-center gap-6">
              <span>{r.person.name}</span>
              <span aria-hidden>★</span>
              <span>@{handle}</span>
              <span aria-hidden>★</span>
              <span>{r.person.location ?? "Worldwide"}</span>
              <span aria-hidden>★</span>
            </span>
          ))}
        </div>
        <style>{`
          @keyframes brutal-marquee {
            from { transform: translateX(0); }
            to   { transform: translateX(-50%); }
          }
        `}</style>
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-8 pt-8 pb-24">
        {/* Hero — asymmetric */}
        <section className="grid grid-cols-12 gap-4 sm:gap-6 mb-16 sm:mb-24">
          <div className="col-span-12 md:col-span-9">
            <div className="text-[12px] tracking-[0.4em] uppercase font-bold mb-3">
              ▍ This is {r.person.name.split(" ")[0]}
            </div>
            <h1 className="font-bold leading-[0.85] tracking-[-0.04em] text-[16vw] md:text-[14vw] lg:text-[180px]">
              {r.person.name.split(" ").map((word, i) => (
                <div key={i} className={i % 2 === 1 ? "text-[#ff3300] -ml-2" : ""}>
                  {word.toUpperCase()}
                </div>
              ))}
            </h1>
          </div>
          <div className="col-span-12 md:col-span-3 flex flex-col justify-end gap-4">
            {r.person.avatarUrl && (
              <Avatar className="size-32 sm:size-40 rounded-none border-[3px] border-black">
                <AvatarImage src={r.person.avatarUrl} alt={r.person.name} className="object-cover grayscale contrast-125" />
                <AvatarFallback className="rounded-none bg-[#ff3300] text-white font-bold text-3xl">
                  {r.person.initials}
                </AvatarFallback>
              </Avatar>
            )}
            <p className="text-base font-medium leading-snug border-l-[3px] border-[#ff3300] pl-3">
              {r.person.description}
            </p>
          </div>
        </section>

        {/* Bold horizontal divider */}
        <Divider />

        {/* About */}
        <BrutalSection num="01" title="The Premise">
          <div className="col-span-12 md:col-span-7 md:col-start-3">
            <div className="prose prose-lg max-w-none [&_p]:mb-4 [&_p]:text-lg [&_p]:leading-snug [&_a]:underline [&_a]:decoration-[3px] [&_a]:underline-offset-4 [&_a]:decoration-[#ff3300]">
              <Markdown>{r.person.summary}</Markdown>
            </div>
          </div>
        </BrutalSection>

        <Divider />

        {/* Work */}
        {!hidden.has("work") && r.work.length > 0 && (
          <BrutalSection num="02" title="The Work">
            <div className="col-span-12 grid grid-cols-12 gap-x-6 gap-y-10">
              {r.work.map((w, i) => (
                <article
                  key={w.id}
                  className={`col-span-12 md:col-span-6 ${i % 2 === 1 ? "md:translate-y-12" : ""}`}
                >
                  <div className="border-[3px] border-black bg-white p-5 hover:bg-[#ff3300] hover:text-white transition-colors group">
                    <div className="flex items-baseline justify-between gap-2 mb-2">
                      <div className="text-[11px] tracking-[0.25em] uppercase font-bold">
                        {String(i + 1).padStart(2, "0")} ─ {w.start} → {w.end}
                      </div>
                      {w.href && (
                        <ArrowUpRight className="size-5 transition-transform group-hover:rotate-45" />
                      )}
                    </div>
                    <h3 className="font-bold text-3xl sm:text-4xl leading-[0.95] tracking-tight uppercase mb-3">
                      {w.company}
                    </h3>
                    <div className="text-sm font-bold mb-3 inline-block bg-black text-white px-2 py-0.5 group-hover:bg-white group-hover:text-[#ff3300]">
                      {w.title}
                    </div>
                    {w.description && (
                      <div className="text-[14.5px] leading-snug [&_p]:mb-2">
                        <Markdown>{w.description}</Markdown>
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </BrutalSection>
        )}

        <Divider />

        {/* Skills — running list */}
        {r.skills.length > 0 && (
          <BrutalSection num="03" title="The Stack">
            <div className="col-span-12">
              <div className="font-bold text-2xl sm:text-4xl leading-[1.2] tracking-tight">
                {r.skills.map((s, i) => (
                  <span key={s.name} className="mr-3">
                    <span className={i % 4 === 0 ? "text-[#ff3300]" : ""}>{s.name}</span>
                    {i < r.skills.length - 1 && <span className="text-black/40 mx-1">/</span>}
                  </span>
                ))}
              </div>
            </div>
          </BrutalSection>
        )}

        <Divider />

        {/* Projects — staggered grid */}
        {!hidden.has("projects") && r.projects.length > 0 && (
          <BrutalSection num="04" title="The Output">
            <div className="col-span-12 grid grid-cols-12 gap-4 sm:gap-6">
              {r.projects.slice(0, 6).map((p, i) => (
                <a
                  key={p.id}
                  href={p.href ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  className={`group block ${
                    i === 0
                      ? "col-span-12 md:col-span-8 md:row-span-2"
                      : i === 1
                        ? "col-span-12 md:col-span-4"
                        : "col-span-6 md:col-span-4"
                  }`}
                >
                  <article className="border-[3px] border-black bg-white h-full flex flex-col">
                    {(p.image || p.video) && (
                      <div className={`w-full ${i === 0 ? "aspect-[16/10]" : "aspect-[4/3]"} overflow-hidden border-b-[3px] border-black bg-[#fafafa]`}>
                        {p.video ? (
                          <video src={p.video} muted loop playsInline autoPlay className="w-full h-full object-cover grayscale contrast-110 group-hover:grayscale-0 transition-all duration-500" />
                        ) : (
                          <img src={p.image} alt={p.title} className="w-full h-full object-cover grayscale contrast-110 group-hover:grayscale-0 transition-all duration-500" />
                        )}
                      </div>
                    )}
                    <div className="p-4 flex-1 flex flex-col">
                      <div className="text-[11px] tracking-[0.25em] uppercase font-bold text-black/60 mb-1">
                        {p.dates}
                      </div>
                      <h3 className={`font-bold tracking-tight uppercase ${i === 0 ? "text-3xl sm:text-4xl leading-[0.95]" : "text-xl leading-tight"}`}>
                        {p.title}
                      </h3>
                      {i === 0 && p.description && (
                        <p className="mt-2 text-[14px] leading-snug line-clamp-3">{p.description}</p>
                      )}
                      {p.technologies.length > 0 && (
                        <div className="mt-auto pt-3 flex flex-wrap gap-1.5">
                          {p.technologies.slice(0, 4).map((t) => (
                            <span key={t} className="text-[10.5px] tracking-wide uppercase font-bold border border-black px-1.5 py-0.5">
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </article>
                </a>
              ))}
            </div>
          </BrutalSection>
        )}

        <Divider />

        {/* Education */}
        {!hidden.has("education") && r.education.length > 0 && (
          <BrutalSection num="05" title="The Schooling">
            <div className="col-span-12 grid grid-cols-12 gap-x-6 gap-y-6">
              {r.education.map((e) => (
                <div key={e.id} className="col-span-12 md:col-span-6 border-l-[6px] border-[#ff3300] pl-4">
                  <div className="text-[11px] tracking-[0.25em] uppercase font-bold mb-1">
                    {e.start} → {e.end}
                  </div>
                  <div className="font-bold text-2xl leading-tight uppercase">{e.school}</div>
                  <div className="text-base mt-1">{e.degree}</div>
                </div>
              ))}
            </div>
          </BrutalSection>
        )}

        {!hidden.has("publications") && r.publications.length > 0 && (
          <>
            <Divider />
            <BrutalSection num="06" title="The Record">
              <div className="col-span-12 space-y-3">
                {r.publications.map((p) => (
                  <a
                    key={p.id}
                    href={p.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block border-b-[2px] border-black py-3 hover:bg-black hover:text-white transition-colors group"
                  >
                    <div className="flex items-baseline justify-between gap-3 flex-wrap">
                      <div className="font-bold text-xl leading-tight uppercase">{p.title}</div>
                      <div className="text-[11px] tracking-[0.25em] uppercase font-bold flex-none">
                        {p.kind}{p.publishedAt ? ` · ${p.publishedAt}` : ""}
                      </div>
                    </div>
                    {p.venue && <div className="text-[13px] mt-1">{p.venue}</div>}
                  </a>
                ))}
              </div>
            </BrutalSection>
          </>
        )}

        <Divider />

        {/* Contact */}
        <section className="mt-16">
          <h2 className="font-bold text-[14vw] md:text-[10vw] lg:text-[140px] leading-[0.85] tracking-[-0.04em] uppercase">
            Get in <span className="text-[#ff3300]">touch.</span>
          </h2>
          <div className="grid grid-cols-12 gap-4 mt-8">
            {r.contact.email && (
              <a
                href={`mailto:${r.contact.email}`}
                className="col-span-12 md:col-span-7 border-[3px] border-black bg-black text-white p-6 flex items-center justify-between hover:bg-[#ff3300] transition-colors"
              >
                <span className="text-2xl font-bold">{r.contact.email}</span>
                <ArrowUpRight className="size-7" />
              </a>
            )}
            <div className="col-span-12 md:col-span-5 grid grid-cols-2 gap-3">
              {socials.slice(0, 4).map((s) => (
                <a
                  key={s.url}
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="border-[3px] border-black p-4 font-bold uppercase tracking-wider text-sm flex items-center justify-between hover:bg-[#ff3300] hover:text-white transition-colors"
                >
                  {s.name} <ArrowUpRight className="size-4" />
                </a>
              ))}
            </div>
          </div>
        </section>

        {/* Footer marquee */}
        <footer className="mt-20 border-t-[3px] border-black pt-4 text-[11px] tracking-[0.3em] uppercase font-bold flex justify-between flex-wrap gap-2">
          <span>End of file</span>
          <span>{r.person.name} · @{handle}</span>
        </footer>
      </div>
    </div>
  );
}

function BrutalSection({
  num,
  title,
  children,
}: {
  num: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="my-12 sm:my-20">
      <div className="grid grid-cols-12 gap-4 sm:gap-6 mb-8">
        <div className="col-span-12 md:col-span-2 text-[11px] tracking-[0.4em] uppercase font-bold">
          §{num}
        </div>
        <h2 className="col-span-12 md:col-span-10 font-bold text-5xl sm:text-7xl leading-[0.9] tracking-[-0.03em] uppercase">
          {title}
        </h2>
      </div>
      <div className="grid grid-cols-12 gap-4 sm:gap-6">{children}</div>
    </section>
  );
}

function Divider() {
  return <div className="my-8 sm:my-12 h-[3px] bg-black" />;
}
