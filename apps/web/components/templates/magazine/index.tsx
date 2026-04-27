/* eslint-disable @next/next/no-img-element */
"use client";

import Markdown from "react-markdown";
import { motion, useScroll, useTransform } from "motion/react";
import { useResume, useHandle } from "@/components/data-provider";
import { allSocials } from "@gitshow/shared/resume";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { LogoOrInitials } from "@/components/logo-or-initials";
import BlurFade from "@/components/magicui/blur-fade";
import { ArrowUpRight, BookmarkIcon } from "lucide-react";

/**
 * Magazine — a literary feature, set in print.
 *
 * Reads like a long-form profile in The New Yorker or Bloomberg
 * Businessweek. Real masthead, drop cap on the lede, multi-column
 * body, pull quotes, image-led project entries with captions, and
 * a colophon at the end. Typography is the design.
 *
 * Best for: founders, designers, writers, and engineers who'd rather
 * be read than scrolled through.
 */
const D = 0.04;

export default function MagazineTemplate() {
  const r = useResume();
  const handle = useHandle();
  const hidden = new Set(r.sections.hidden);
  const socials = allSocials(r);
  const firstName = r.person.name.split(" ")[0] ?? r.person.name;
  const issue = formatIssue(r.meta.updatedAt);
  const issueNo = computeIssueNo(r.meta.version);
  const pullQuote = extractPullQuote(r.person.summary);

  return (
    <div
      className="min-h-dvh bg-[#f7f3ea] text-[#1a1612] antialiased"
      style={{
        fontFeatureSettings: '"liga","dlig","onum","kern"',
        backgroundImage:
          "radial-gradient(ellipse at top, rgba(181,63,36,0.04), transparent 50%), repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(26,22,18,0.012) 3px)",
      }}
    >
      <ParallaxBanner />

      <div className="mx-auto max-w-[1200px] px-6 sm:px-12 pt-10 pb-32">
        <Masthead handle={handle} firstName={firstName} issue={issue} issueNo={issueNo} />

        {/* Cover feature */}
        <CoverFeature
          name={r.person.name}
          description={r.person.description}
          avatarUrl={r.person.avatarUrl}
          initials={r.person.initials}
          location={r.person.location}
          handle={handle}
        />

        <RuleHeavy />

        {/* The lede — drop cap, multi-column body */}
        <Lede summary={r.person.summary} pullQuote={pullQuote} />

        {/* Sidebar bio + main career feature */}
        {!hidden.has("work") && r.work.length > 0 && (
          <CareerFeature work={r.work} />
        )}

        {/* Selected works — magazine-style portfolio spread */}
        {!hidden.has("projects") && r.projects.length > 0 && (
          <SelectedWorks projects={r.projects} />
        )}

        {/* Sidebar grid: skills + education side-by-side */}
        <SidebarGrid r={r} hidden={hidden} />

        {/* Field notes — hackathons + build log treated as recent activity */}
        {(!hidden.has("hackathons") && r.hackathons.length > 0) ||
        (!hidden.has("buildLog") && r.buildLog.length > 0) ? (
          <FieldNotes
            hackathons={hidden.has("hackathons") ? [] : r.hackathons}
            buildLog={hidden.has("buildLog") ? [] : r.buildLog}
          />
        ) : null}

        {/* Bibliography — publications */}
        {!hidden.has("publications") && r.publications.length > 0 && (
          <Bibliography publications={r.publications} />
        )}

        {/* Letters — contact section as "Letters to the editor" */}
        <Correspondence
          email={r.contact.email}
          socials={socials}
          name={r.person.name}
        />

        <Colophon name={r.person.name} handle={handle} updatedAt={r.meta.updatedAt} />
      </div>
    </div>
  );
}

/* ─────────────────────────  Components  ────────────────────────── */

function ParallaxBanner() {
  // A faint paper-grain bar at the top that scrolls slightly slower than
  // the page. Subtle; gives the page a sense of physical depth.
  const { scrollY } = useScroll();
  const y = useTransform(scrollY, [0, 600], [0, -80]);
  return (
    <motion.div
      style={{ y }}
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 h-[200px] z-0 opacity-[0.4]"
    >
      <div
        className="h-full w-full"
        style={{
          background:
            "linear-gradient(180deg, rgba(181,63,36,0.06), transparent), radial-gradient(circle at 20% 30%, rgba(181,63,36,0.05), transparent 40%), radial-gradient(circle at 80% 60%, rgba(26,22,18,0.04), transparent 50%)",
        }}
      />
    </motion.div>
  );
}

function Masthead({
  handle,
  firstName,
  issue,
  issueNo,
}: {
  handle: string;
  firstName: string;
  issue: string;
  issueNo: string;
}) {
  return (
    <BlurFade delay={D}>
      <header className="border-y-[3px] border-double border-[#1a1612] py-3 mb-12 flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-4">
          <span className="font-serif text-[28px] leading-none italic">Folio</span>
          <span className="hidden sm:inline text-[10px] tracking-[0.4em] uppercase font-bold text-[#5a5046]">
            The {firstName} Quarterly
          </span>
        </div>
        <div className="text-[10px] tracking-[0.3em] uppercase font-bold text-[#5a5046] flex items-baseline gap-3">
          <span>{issue}</span>
          <span aria-hidden>·</span>
          <span>Issue №{issueNo}</span>
          <span aria-hidden>·</span>
          <span>@{handle}</span>
        </div>
      </header>
    </BlurFade>
  );
}

function CoverFeature({
  name,
  description,
  avatarUrl,
  initials,
  location,
  handle,
}: {
  name: string;
  description: string;
  avatarUrl?: string;
  initials: string;
  location?: string;
  handle: string;
}) {
  const lastName = name.split(" ").slice(1).join(" ");
  const firstName = name.split(" ")[0];
  return (
    <section className="grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-12 mb-20">
      <div className="md:col-span-7 flex flex-col">
        <BlurFade delay={D * 2}>
          <div className="text-[10px] tracking-[0.4em] uppercase text-[#b53f24] font-bold mb-6 inline-flex items-center gap-2">
            <span aria-hidden className="size-1 rounded-full bg-[#b53f24]" />
            Profile · {location ?? "At large"}
          </div>
        </BlurFade>

        <BlurFade delay={D * 3}>
          <h1 className="font-serif leading-[0.9] tracking-[-0.02em] text-[64px] sm:text-[88px] md:text-[112px]">
            <span className="block">{firstName}</span>
            {lastName && (
              <span className="block italic text-[#b53f24]">{lastName}.</span>
            )}
          </h1>
        </BlurFade>

        <BlurFade delay={D * 5}>
          <p className="font-serif text-2xl sm:text-[28px] leading-[1.3] mt-8 text-[#3a322a] max-w-[36ch]">
            “{description}”
          </p>
        </BlurFade>

        <BlurFade delay={D * 7}>
          <div className="mt-10 flex items-center gap-4 text-[12px] tracking-wide uppercase text-[#5a5046]">
            <span>By a Folio Correspondent</span>
            <span aria-hidden className="h-px w-8 bg-[#5a5046]/40" />
            <a
              href={`/${handle}`}
              className="inline-flex items-center gap-1 hover:text-[#b53f24] transition-colors"
            >
              Read on <ArrowUpRight className="size-3.5" />
            </a>
          </div>
        </BlurFade>
      </div>

      {avatarUrl ? (
        <BlurFade delay={D * 4} className="md:col-span-5">
          <figure className="relative">
            <div className="relative">
              <Avatar className="size-full aspect-[4/5] rounded-none border border-[#1a1612] [&_img]:rounded-none">
                <AvatarImage
                  src={avatarUrl}
                  alt={name}
                  className="object-cover sepia-[0.15] contrast-[1.05]"
                />
                <AvatarFallback className="rounded-none bg-[#e9dfca] text-[#1a1612] font-serif text-6xl">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div
                aria-hidden
                className="absolute inset-0 pointer-events-none mix-blend-multiply opacity-30"
                style={{
                  background:
                    "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.06) 3px)",
                }}
              />
              <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-[#1a1612] text-[#f7f3ea] text-[10px] tracking-[0.3em] uppercase font-bold px-4 py-1.5 whitespace-nowrap">
                The Cover Story
              </div>
            </div>
            <figcaption className="mt-6 pt-3 border-t border-[#5a5046]/30 text-[11px] italic text-[#5a5046] leading-snug">
              {name}, photographed for Folio.
              {location && ` In ${location}, ${new Date().getFullYear()}.`}
            </figcaption>
          </figure>
        </BlurFade>
      ) : null}
    </section>
  );
}

function RuleHeavy() {
  return (
    <div className="my-12 flex items-center justify-center gap-3" aria-hidden>
      <div className="h-[3px] flex-1 bg-[#1a1612]" />
      <div className="size-2 rotate-45 bg-[#b53f24]" />
      <div className="h-[3px] flex-1 bg-[#1a1612]" />
    </div>
  );
}

function SectionHead({
  eyebrow,
  title,
  kicker,
}: {
  eyebrow: string;
  title: string;
  kicker?: string;
}) {
  return (
    <BlurFade delay={D * 2}>
      <header className="mb-10">
        <div className="text-[10px] tracking-[0.4em] uppercase text-[#b53f24] font-bold mb-3 inline-flex items-center gap-2">
          <span aria-hidden className="size-1 rounded-full bg-[#b53f24]" />
          {eyebrow}
        </div>
        <h2 className="font-serif text-[44px] sm:text-[56px] leading-[0.95] tracking-[-0.02em]">
          {title}
        </h2>
        {kicker && (
          <p className="font-serif italic text-xl text-[#5a5046] mt-3 max-w-prose">
            {kicker}
          </p>
        )}
        <div className="mt-5 h-[2px] w-24 bg-[#1a1612]" />
      </header>
    </BlurFade>
  );
}

function Lede({ summary, pullQuote }: { summary: string; pullQuote?: string }) {
  return (
    <section className="mb-24">
      <SectionHead eyebrow="Letter from the desk" title="On craft, lately." />
      <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
        <BlurFade delay={D * 4} className="md:col-span-8">
          <div
            className="text-[17px] leading-[1.75] text-[#2a241d] font-serif md:columns-2 md:gap-10 [column-fill:balance] first-letter:font-serif first-letter:text-[88px] first-letter:leading-[0.85] first-letter:float-left first-letter:mr-3 first-letter:mt-2 first-letter:text-[#b53f24] [&>p]:mb-4 [&>p:last-child]:mb-0 [&_a]:text-[#b53f24] [&_a]:underline-offset-4 hover:[&_a]:underline"
          >
            <Markdown
              components={{
                p: ({ children }) => <p>{children}</p>,
                a: ({ href, children }) => (
                  <a href={href}>{children}</a>
                ),
              }}
            >
              {summary}
            </Markdown>
          </div>
        </BlurFade>

        {pullQuote && (
          <BlurFade delay={D * 6} className="md:col-span-4">
            <aside className="md:sticky md:top-12 border-l-[3px] border-[#b53f24] pl-6 py-4">
              <div className="text-[10px] tracking-[0.4em] uppercase text-[#b53f24] font-bold mb-3">
                Pull quote
              </div>
              <blockquote className="font-serif italic text-2xl leading-[1.3] text-[#1a1612]">
                “{pullQuote}”
              </blockquote>
            </aside>
          </BlurFade>
        )}
      </div>
    </section>
  );
}

function CareerFeature({
  work,
}: {
  work: ReturnType<typeof useResume>["work"];
}) {
  return (
    <section className="mb-24">
      <SectionHead
        eyebrow="A career, abridged"
        title="The notable engagements."
        kicker="Where the time has been spent, in the order it was spent there."
      />
      <ol className="space-y-12 counter-reset-[engagement]">
        {work.map((w, i) => (
          <BlurFade key={w.id} delay={D * (3 + i * 0.5)}>
            <article className="grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-10 group">
              {/* Column 1: numbered marker + dates */}
              <div className="md:col-span-3 flex md:flex-col gap-3 md:gap-2 items-baseline md:items-start">
                <div className="font-serif italic text-[44px] leading-none text-[#b53f24] tabular-nums">
                  {String(i + 1).padStart(2, "0")}
                </div>
                <div className="text-[11px] tracking-[0.2em] uppercase text-[#5a5046] font-bold tabular-nums">
                  {w.start} – {w.end}
                </div>
                {w.location && (
                  <div className="text-[12px] italic text-[#5a5046] mt-1 hidden md:block">
                    {w.location}
                  </div>
                )}
              </div>

              {/* Column 2: headline + body */}
              <div className="md:col-span-9 border-t border-[#1a1612]/15 pt-6 md:pt-0 md:border-none">
                <div className="flex items-baseline gap-3 flex-wrap mb-2">
                  <LogoOrInitials src={w.logoUrl} name={w.company} />
                  <h3 className="font-serif text-3xl sm:text-4xl leading-[1.05] tracking-[-0.01em]">
                    <span className="font-bold">{w.company}</span>
                    {", "}
                    <span className="italic text-[#5a5046]">{w.title}</span>
                  </h3>
                </div>
                {w.description && (
                  <div className="prose prose-lg mt-4 text-[16.5px] leading-[1.75] text-[#2a241d] max-w-prose font-serif [&_p]:mb-3 [&_a]:text-[#b53f24] [&_a]:underline-offset-4 hover:[&_a]:underline">
                    <Markdown>{w.description}</Markdown>
                  </div>
                )}
                {w.badges && w.badges.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {w.badges.map((b) => (
                      <span
                        key={b}
                        className="text-[10px] tracking-[0.2em] uppercase font-bold text-[#5a5046] border border-[#5a5046]/30 px-2 py-0.5"
                      >
                        {b}
                      </span>
                    ))}
                  </div>
                )}
                {w.href && (
                  <a
                    href={w.href}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-4 inline-flex items-center gap-1 text-[12px] uppercase tracking-wide text-[#b53f24] hover:underline underline-offset-4 font-bold"
                  >
                    Visit {new URL(w.href).hostname.replace("www.", "")}
                    <ArrowUpRight className="size-3" />
                  </a>
                )}
              </div>
            </article>
          </BlurFade>
        ))}
      </ol>
    </section>
  );
}

function SelectedWorks({
  projects,
}: {
  projects: ReturnType<typeof useResume>["projects"];
}) {
  const featured = projects[0];
  const grid = projects.slice(1, 9);
  return (
    <section className="mb-24">
      <SectionHead
        eyebrow="A portfolio review"
        title="Selected works."
        kicker="Eight projects worth turning the page for."
      />

      {/* Hero project — full width feature */}
      {featured && (
        <BlurFade delay={D * 3}>
          <a
            href={featured.href ?? "#"}
            target="_blank"
            rel="noreferrer"
            className="group block mb-16"
          >
            <figure>
              {(featured.image || featured.video) && (
                <div className="aspect-[16/9] overflow-hidden border border-[#1a1612]/40 bg-[#e9dfca]">
                  {featured.video ? (
                    <video
                      src={featured.video}
                      muted
                      loop
                      playsInline
                      autoPlay
                      className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.02]"
                    />
                  ) : (
                    <img
                      src={featured.image}
                      alt={featured.title}
                      className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.02]"
                    />
                  )}
                </div>
              )}
              <figcaption className="mt-6 grid grid-cols-1 md:grid-cols-12 gap-6">
                <div className="md:col-span-2 text-[10px] tracking-[0.3em] uppercase text-[#b53f24] font-bold">
                  Cover work · {featured.dates}
                </div>
                <div className="md:col-span-7">
                  <h3 className="font-serif text-4xl leading-[1.05] tracking-[-0.01em] mb-3 group-hover:text-[#b53f24] transition-colors flex items-baseline gap-2">
                    {featured.title}
                    <ArrowUpRight className="size-6 transition-transform group-hover:rotate-12" />
                  </h3>
                  <div className="text-[15px] leading-[1.7] text-[#3a322a] font-serif [&_p]:mb-2 [&_a]:text-[#b53f24]">
                    <Markdown>{featured.description}</Markdown>
                  </div>
                </div>
                <div className="md:col-span-3 text-[12px] italic text-[#5a5046] leading-relaxed">
                  {featured.technologies.length > 0 && (
                    <>
                      <span className="block uppercase not-italic font-bold tracking-wider text-[10px] text-[#1a1612] mb-1">
                        Built with
                      </span>
                      {featured.technologies.join(" · ")}
                    </>
                  )}
                </div>
              </figcaption>
            </figure>
          </a>
        </BlurFade>
      )}

      {/* Grid of remaining works */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-16">
        {grid.map((p, i) => (
          <BlurFade key={p.id} delay={D * (4 + i * 0.5)} inView>
            <a
              href={p.href ?? "#"}
              target="_blank"
              rel="noreferrer"
              className="group block"
            >
              <article>
                {(p.image || p.video) && (
                  <div className="aspect-[3/2] overflow-hidden border border-[#1a1612]/30 bg-[#e9dfca] mb-5">
                    {p.video ? (
                      <video
                        src={p.video}
                        muted
                        loop
                        playsInline
                        autoPlay
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                      />
                    ) : (
                      <img
                        src={p.image}
                        alt={p.title}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                      />
                    )}
                  </div>
                )}
                <div className="text-[10px] tracking-[0.3em] uppercase text-[#b53f24] font-bold mb-1">
                  {p.dates} {p.active && "· Now"}
                </div>
                <h3 className="font-serif text-2xl leading-[1.1] mb-2 group-hover:text-[#b53f24] transition-colors">
                  {p.title}
                </h3>
                <div className="text-[14.5px] leading-[1.65] text-[#3a322a] font-serif [&_p]:mb-2 [&_a]:text-[#b53f24]">
                  <Markdown>{p.description}</Markdown>
                </div>
                {p.technologies.length > 0 && (
                  <div className="mt-3 text-[12px] italic text-[#5a5046] border-t border-[#5a5046]/20 pt-3">
                    {p.technologies.slice(0, 6).join(" · ")}
                  </div>
                )}
                {p.links && p.links.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] uppercase tracking-wide font-bold">
                    {p.links.slice(0, 3).map((l) => (
                      <span
                        key={l.label}
                        className="text-[#1a1612] inline-flex items-center gap-1"
                      >
                        → {l.label}
                      </span>
                    ))}
                  </div>
                )}
              </article>
            </a>
          </BlurFade>
        ))}
      </div>
    </section>
  );
}

function SidebarGrid({
  r,
  hidden,
}: {
  r: ReturnType<typeof useResume>;
  hidden: Set<string>;
}) {
  return (
    <section className="mb-24 grid grid-cols-1 md:grid-cols-12 gap-12">
      {r.skills.length > 0 && (
        <div className="md:col-span-7">
          <SectionHead eyebrow="The toolbox" title="Instruments of the trade." />
          <BlurFade delay={D * 4}>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6">
              {r.skills.map((s) => (
                <div
                  key={s.name}
                  className="border-t border-[#1a1612]/20 py-2.5 flex items-baseline justify-between gap-2 text-[14.5px] font-serif"
                >
                  <span>{s.name}</span>
                  {s.usageCount && (
                    <span className="text-[#5a5046] tabular-nums text-[12px] italic">
                      ×{s.usageCount}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </BlurFade>
        </div>
      )}

      {!hidden.has("education") && r.education.length > 0 && (
        <div className="md:col-span-5">
          <SectionHead eyebrow="The schooling" title="Where it began." />
          <BlurFade delay={D * 5}>
            <ul className="space-y-7">
              {r.education.map((e) => (
                <li key={e.id} className="border-l-2 border-[#b53f24]/40 pl-5">
                  <div className="text-[10px] tracking-[0.3em] uppercase text-[#5a5046] font-bold tabular-nums mb-1">
                    {e.start} – {e.end}
                  </div>
                  <div className="font-serif text-2xl leading-tight">
                    {e.school}
                  </div>
                  <div className="font-serif italic text-[15px] text-[#3a322a] mt-1">
                    {e.degree}
                  </div>
                </li>
              ))}
            </ul>
          </BlurFade>
        </div>
      )}
    </section>
  );
}

function FieldNotes({
  hackathons,
  buildLog,
}: {
  hackathons: ReturnType<typeof useResume>["hackathons"];
  buildLog: ReturnType<typeof useResume>["buildLog"];
}) {
  if (hackathons.length === 0 && buildLog.length === 0) return null;
  return (
    <section className="mb-24">
      <SectionHead
        eyebrow="Field notes"
        title="From the workbench."
        kicker="Hackathons, side experiments, and the small things that keep the engine warm."
      />
      <div className="grid grid-cols-1 md:grid-cols-12 gap-12">
        {hackathons.length > 0 && (
          <div className="md:col-span-5">
            <BlurFade delay={D * 4}>
              <h3 className="font-serif text-2xl mb-5 inline-flex items-baseline gap-2">
                <BookmarkIcon className="size-4 text-[#b53f24]" />
                Hackathons
              </h3>
              <ul className="space-y-4">
                {hackathons.map((h) => (
                  <li key={h.id} className="border-b border-[#1a1612]/15 pb-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="font-serif text-lg leading-tight">
                        {h.title}
                      </div>
                      {h.date && (
                        <div className="text-[11px] uppercase tracking-wide text-[#5a5046] tabular-nums flex-none">
                          {h.date}
                        </div>
                      )}
                    </div>
                    {h.rank && (
                      <div className="text-[12px] italic text-[#b53f24] mt-1">
                        ★ {h.rank}
                      </div>
                    )}
                    {h.description && (
                      <p className="text-[14px] text-[#3a322a] mt-1.5 leading-snug font-serif">
                        {h.description}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </BlurFade>
          </div>
        )}

        {buildLog.length > 0 && (
          <div className="md:col-span-7">
            <BlurFade delay={D * 5}>
              <h3 className="font-serif text-2xl mb-5">Build log</h3>
              <ol className="space-y-2">
                {buildLog.slice(0, 12).map((b) => (
                  <li
                    key={b.id}
                    className="grid grid-cols-[80px_12px_1fr] items-baseline gap-3 text-[13.5px] py-1.5 border-b border-[#1a1612]/10 last:border-b-0"
                  >
                    <span className="text-[11px] tracking-wide uppercase font-bold text-[#5a5046] tabular-nums">
                      {b.dates}
                    </span>
                    <span
                      aria-hidden
                      className="size-2 rounded-full"
                      style={{ background: b.languageColor ?? "#b53f24" }}
                    />
                    <span className="text-[#1a1612] font-serif">
                      <span className="font-bold">{b.title}</span>
                      <span className="text-[#5a5046]"> — {b.description}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </BlurFade>
          </div>
        )}
      </div>
    </section>
  );
}

function Bibliography({
  publications,
}: {
  publications: ReturnType<typeof useResume>["publications"];
}) {
  return (
    <section className="mb-24">
      <SectionHead
        eyebrow="In print"
        title="A short bibliography."
        kicker="Talks, papers, podcasts, and other things written down."
      />
      <BlurFade delay={D * 4}>
        <ol className="space-y-8">
          {publications.map((p, i) => (
            <li
              key={p.id}
              className="grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-10 group"
            >
              <div className="md:col-span-2 font-serif italic text-[44px] leading-none text-[#b53f24]/40 tabular-nums">
                {String(i + 1).padStart(2, "0")}
              </div>
              <div className="md:col-span-10 border-t border-[#1a1612]/15 pt-4">
                <div className="text-[10px] tracking-[0.3em] uppercase font-bold text-[#5a5046] mb-2">
                  {p.kind}{p.publishedAt ? ` · ${p.publishedAt}` : ""}
                </div>
                <a
                  href={p.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-serif text-2xl leading-tight hover:text-[#b53f24] transition-colors inline-flex items-baseline gap-2"
                >
                  {p.title}
                  <ArrowUpRight className="size-4 opacity-60" />
                </a>
                {p.venue && (
                  <div className="text-[15px] italic text-[#3a322a] mt-1 font-serif">
                    {p.venue}
                  </div>
                )}
                {p.summary && (
                  <p className="text-[14.5px] text-[#3a322a] mt-2 leading-relaxed font-serif max-w-prose">
                    {p.summary}
                  </p>
                )}
                {p.coAuthors && p.coAuthors.length > 0 && (
                  <div className="text-[12px] text-[#5a5046] mt-2 italic">
                    With {p.coAuthors.join(", ")}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      </BlurFade>
    </section>
  );
}

function Correspondence({
  email,
  socials,
  name,
}: {
  email?: string;
  socials: ReturnType<typeof allSocials>;
  name: string;
}) {
  return (
    <section className="mb-20">
      <SectionHead
        eyebrow="Correspondence"
        title="Letters to the editor."
        kicker={`Direct correspondence with ${name.split(" ")[0]} is welcome.`}
      />
      <BlurFade delay={D * 4}>
        <div className="grid grid-cols-1 md:grid-cols-12 gap-12">
          {email && (
            <a
              href={`mailto:${email}`}
              className="md:col-span-7 group block border-2 border-[#1a1612] p-8 hover:bg-[#1a1612] hover:text-[#f7f3ea] transition-colors"
            >
              <div className="text-[10px] tracking-[0.3em] uppercase font-bold text-[#b53f24] group-hover:text-[#f7f3ea] mb-2">
                Direct line
              </div>
              <div className="font-serif text-3xl leading-tight break-all">
                {email}
              </div>
              <div className="text-[12px] italic mt-3 opacity-70 inline-flex items-center gap-1">
                Compose a message
                <ArrowUpRight className="size-3" />
              </div>
            </a>
          )}
          <div className="md:col-span-5">
            <div className="text-[10px] tracking-[0.3em] uppercase font-bold text-[#b53f24] mb-3">
              Elsewhere
            </div>
            <ul className="space-y-3">
              {socials.map((s) => (
                <li key={s.url}>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="group flex items-baseline justify-between border-b border-[#1a1612]/30 pb-2 hover:border-[#b53f24] transition-colors"
                  >
                    <span className="font-serif text-xl">{s.name}</span>
                    <span className="text-[12px] italic text-[#5a5046] group-hover:text-[#b53f24] transition-colors">
                      {prettyUrl(s.url)} →
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </BlurFade>
    </section>
  );
}

function Colophon({
  name,
  handle,
  updatedAt,
}: {
  name: string;
  handle: string;
  updatedAt: string;
}) {
  return (
    <BlurFade delay={D * 6}>
      <footer className="mt-20 pt-8 border-t-[3px] border-double border-[#1a1612] grid grid-cols-1 md:grid-cols-12 gap-8 text-[12px]">
        <div className="md:col-span-5">
          <div className="text-[10px] tracking-[0.3em] uppercase font-bold text-[#5a5046] mb-2">
            Colophon
          </div>
          <p className="text-[#3a322a] leading-relaxed font-serif italic">
            Set in a serif body face for the long read and a grotesque for the
            captions. Printed on a screen near you. Curated by Folio. Edition
            updated {formatLong(updatedAt)}.
          </p>
        </div>
        <div className="md:col-span-7 md:text-right text-[#5a5046]">
          <div className="text-[10px] tracking-[0.3em] uppercase font-bold mb-2">
            End matter
          </div>
          <p className="font-serif italic">
            {name} · @{handle} · © {new Date().getFullYear()}. All rights
            reserved, although stories like this can't really be owned.
          </p>
        </div>
      </footer>
    </BlurFade>
  );
}

/* ─────────────────────────  Helpers  ────────────────────────── */

function formatIssue(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "April 2026";
    return `${d.toLocaleString("en-US", { month: "long" })} ${d.getFullYear()}`;
  } catch {
    return "April 2026";
  }
}

function formatLong(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "this morning";
    return d.toLocaleString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "this morning";
  }
}

function computeIssueNo(version: number): string {
  return String((version % 99) + 1).padStart(2, "0");
}

function prettyUrl(u: string): string {
  try {
    const url = new URL(u);
    return url.hostname.replace(/^www\./, "") + url.pathname.replace(/\/$/, "");
  } catch {
    return u;
  }
}

/**
 * Pull the most quotable sentence out of the about text — first
 * sentence between 60 and 220 chars, prefer ones with a verb.
 */
function extractPullQuote(summary: string): string | undefined {
  const stripped = summary
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const sentences = stripped.match(/[^.!?]+[.!?]/g) ?? [];
  for (const s of sentences) {
    const t = s.trim();
    if (t.length >= 60 && t.length <= 220) return t.replace(/[.!?]$/, "");
  }
  return undefined;
}
