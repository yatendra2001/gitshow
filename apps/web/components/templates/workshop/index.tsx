/* eslint-disable @next/next/no-img-element */
"use client";

import { useMemo } from "react";
import { motion } from "motion/react";
import { useResume, useHandle } from "@/components/data-provider";
import ContributionTrend from "@/components/contribution-trend";
import { allSocials } from "@gitshow/shared/resume";
import { formatResumeDateRange } from "@/lib/format-date";

/**
 * Workshop — a portfolio that reads like an open-source README poster.
 *
 * Big outlined ASCII-style headline, framed terminal window chrome, and
 * a dashboard of bordered green panels (BY THE NUMBERS, SPECIALISTS,
 * POWER TOOLS, QUICK START) that map the user's resume data onto the
 * "founder's monorepo README" poster aesthetic.
 *
 * Best for: builders with a deep project shelf — every project becomes
 * a card in the SPECIALISTS grid, every skill becomes a POWER TOOL,
 * every job becomes a numbered QUICK START step.
 */

// ─────────────────────────  Palette  ─────────────────────────
const BG = "#0a0d10";
const BG_CARD = "#0d1117";
const BG_HEADER = "#0e1217";
const BORDER = "#1f6b3a";
const BORDER_DIM = "rgba(126, 231, 135, 0.22)";
const ACCENT_GREEN = "#7ee787";
const ACCENT_CYAN = "#79c0ff";
const ACCENT_ORANGE = "#ffa657";
const ACCENT_PINK = "#f778ba";
const ACCENT_YELLOW = "#f9e2af";
const FG = "#e6edf3";
const FG_DIM = "#8b949e";
const FG_FAINT = "#6e7681";

export default function WorkshopTemplate() {
  const r = useResume();
  const handle = useHandle();
  const hidden = new Set(r.sections.hidden);
  const socials = allSocials(r);

  const stats = useMemo(() => computeStats(r), [r]);
  const summaryBullets = useMemo(
    () => extractBullets(r.person.summary),
    [r.person.summary],
  );
  const heroQuote = useMemo(() => pickQuote(r), [r]);
  const topProject = r.projects[0];
  const techCloud = useMemo(() => collectTechs(r), [r]);

  return (
    <div
      className="min-h-dvh font-mono antialiased"
      style={{
        background: BG,
        color: FG,
        fontSize: "13.5px",
        lineHeight: "1.6",
        backgroundImage:
          "radial-gradient(ellipse at 50% -20%, rgba(126,231,135,0.06), transparent 60%)",
      }}
    >
      <Scanline />

      <div className="mx-auto max-w-[1200px] px-3 sm:px-6 py-6 sm:py-10">
        <WindowFrame title={`${handle}@workshop:~$ cat README.md`}>
          {/* ───── Hero row ───── */}
          <Hero r={r} handle={handle} quote={heroQuote} />

          {/* ───── Stats / What is / Install row ───── */}
          <div className="mt-5 grid grid-cols-1 lg:grid-cols-[1.05fr_0.95fr] gap-5">
            <Panel title="BY THE NUMBERS" subtitle="(measured on logical code)">
              <ByTheNumbers stats={stats} />
            </Panel>

            <div className="flex flex-col gap-5">
              <Panel title={`WHAT IS @${handle.toUpperCase()}?`}>
                <WhatIs
                  bullets={summaryBullets}
                  projectCount={r.projects.length}
                  skillCount={r.skills.length}
                />
              </Panel>

              {topProject?.href && (
                <Panel title="INSTALL IN 30 SECONDS">
                  <InstallBlock
                    href={topProject.href}
                    title={topProject.title}
                  />
                </Panel>
              )}
            </div>
          </div>

          {/* ───── Contribution trend ───── */}
          <div className="mt-5">
            <Panel
              title="GH CONTRIBUTIONS"
              subtitle="(streamed live · github.com)"
            >
              <ContributionTrend
                handle={handle}
                accent={ACCENT_GREEN}
                fg={FG}
                dim={FG_DIM}
                ghost={"#30363d"}
                cardBg="transparent"
                cardBorder="transparent"
                radius={0}
                chartHeight={110}
                pad={{ x: 0, y: 8 }}
                eyebrow="lifetime"
                caption="github.com"
                tooltipBg={BG}
                tooltipBorder={BORDER_DIM}
              />
            </Panel>
          </div>

          {/* ───── Projects grid (the "specialists") ───── */}
          {!hidden.has("projects") && r.projects.length > 0 && (
            <div className="mt-5">
              <Panel
                title={`THE ${r.projects.length} SPECIALISTS`}
                subtitle="(slash commands)"
              >
                <SpecialistsGrid projects={r.projects} />
              </Panel>
            </div>
          )}

          {/* ───── Power tools / Works with / Quick start row ───── */}
          <div className="mt-5 grid grid-cols-1 lg:grid-cols-[1.2fr_0.9fr_1fr] gap-5">
            {!hidden.has("skills") && r.skills.length > 0 && (
              <Panel
                title={`${r.skills.length} POWER TOOLS`}
                subtitle="(on demand)"
              >
                <PowerTools skills={r.skills} />
              </Panel>
            )}

            {techCloud.length > 0 && (
              <Panel
                title={`WORKS WITH ${techCloud.length}+ TOOLS`}
              >
                <TechCloud techs={techCloud} />
              </Panel>
            )}

            {!hidden.has("work") && r.work.length > 0 && (
              <Panel title="QUICK START" subtitle="(career)">
                <QuickStart work={r.work.slice(0, 3)} />
              </Panel>
            )}
          </div>

          {/* ───── Education + Hackathons row ───── */}
          {((!hidden.has("education") && r.education.length > 0) ||
            (!hidden.has("hackathons") && r.hackathons.length > 0)) && (
            <div className="mt-5 grid grid-cols-1 lg:grid-cols-2 gap-5">
              {!hidden.has("education") && r.education.length > 0 && (
                <Panel title="EDUCATION" subtitle="(transcripts)">
                  <EducationList items={r.education} />
                </Panel>
              )}
              {!hidden.has("hackathons") && r.hackathons.length > 0 && (
                <Panel
                  title="HACKATHON LOG"
                  subtitle={`(${r.hackathons.length} entries)`}
                >
                  <HackathonsLog items={r.hackathons.slice(0, 6)} />
                </Panel>
              )}
            </div>
          )}

          {/* ───── Build log ───── */}
          {!hidden.has("buildLog") && r.buildLog.length > 0 && (
            <div className="mt-5">
              <Panel
                title="GIT LOG"
                subtitle={`(${r.buildLog.length} commits)`}
              >
                <BuildLogList items={r.buildLog.slice(0, 12)} />
              </Panel>
            </div>
          )}

          {/* ───── Publications ───── */}
          {!hidden.has("publications") && r.publications.length > 0 && (
            <div className="mt-5">
              <Panel title="PUBLICATIONS" subtitle="(papers · talks · podcasts)">
                <PublicationsList items={r.publications.slice(0, 8)} />
              </Panel>
            </div>
          )}

          {/* ───── Footer row ───── */}
          <div className="mt-5 grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr_0.9fr] gap-5 pb-2">
            <Panel title=">">
              <FooterPrompt name={r.person.name} />
            </Panel>

            {!hidden.has("contact") && (
              <Panel title="CONTACT">
                <ContactBlock
                  email={r.contact.email}
                  socials={socials}
                  url={r.person.url}
                />
              </Panel>
            )}

            <Panel title={`${handle}@workshop:~$ ship`}>
              <ShipOutput projects={r.projects.length} skills={r.skills.length} />
            </Panel>
          </div>
        </WindowFrame>
      </div>
    </div>
  );
}

/* ─────────────────────────  Window chrome  ─────────────────────────── */

function WindowFrame({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="rounded-2xl overflow-hidden border shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)]"
      style={{ background: BG, borderColor: BORDER }}
    >
      <header
        className="flex items-center px-4 py-2.5 border-b select-none"
        style={{ background: BG_HEADER, borderColor: BORDER }}
      >
        <div className="flex items-center gap-1.5">
          <span className="size-3 rounded-full bg-[#ff5f56]" />
          <span className="size-3 rounded-full bg-[#ffbd2e]" />
          <span className="size-3 rounded-full bg-[#27c93f]" />
        </div>
        <div
          className="flex-1 text-center text-[12px] truncate px-4"
          style={{ color: FG_DIM }}
        >
          {title}
        </div>
        <div
          className="text-[11px] tracking-wider hidden sm:block"
          style={{ color: FG_FAINT }}
        >
          README.md
        </div>
      </header>

      <div
        className="p-4 sm:p-6 selection:bg-[#264f78]"
        style={{ background: BG }}
      >
        {children}
      </div>
    </motion.div>
  );
}

/* ─────────────────────────  Panel (bordered card)  ─────────────────── */

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-15%" }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="rounded-lg border h-full flex flex-col"
      style={{ borderColor: BORDER_DIM, background: BG_CARD }}
    >
      <header className="px-4 pt-3 pb-2 flex items-baseline gap-2 flex-wrap">
        <span
          className="text-[12px] font-bold tracking-wider"
          style={{ color: ACCENT_CYAN }}
        >
          &gt; {title}
        </span>
        {subtitle && (
          <span className="text-[11px]" style={{ color: FG_FAINT }}>
            {subtitle}
          </span>
        )}
      </header>
      <div className="px-4 pb-4 flex-1">{children}</div>
    </motion.section>
  );
}

/* ─────────────────────────  Hero  ─────────────────────────── */

function Hero({
  r,
  handle,
  quote,
}: {
  r: ReturnType<typeof useResume>;
  handle: string;
  quote: { text: string; attribution: string; source?: string } | null;
}) {
  return (
    <div
      className="rounded-lg border overflow-hidden"
      style={{ borderColor: BORDER_DIM, background: BG_CARD }}
    >
      <div
        className="px-4 py-2 border-b text-[11px]"
        style={{
          background: "rgba(13,17,23,0.6)",
          borderColor: BORDER_DIM,
          color: FG_DIM,
        }}
      >
        <span style={{ color: ACCENT_CYAN }}>{handle}</span>
        <span style={{ color: FG_FAINT }}>@</span>
        <span style={{ color: ACCENT_ORANGE }}>workshop</span>
        <span style={{ color: FG_FAINT }}>:~$ </span>
        <span style={{ color: FG }}>cat README.md</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr_0.7fr] gap-6 p-5 sm:p-6">
        {/* Left: Big ASCII title */}
        <div className="min-w-0">
          <AsciiTitle text={handle} />
          <p
            className="mt-3 text-[14px] leading-relaxed"
            style={{ color: ACCENT_CYAN }}
          >
            {r.person.description}
          </p>
          <p className="mt-2 text-[13px]" style={{ color: FG }}>
            {r.projects.length} projects.{" "}
            {r.skills.length} power tools.{" "}
            <span style={{ color: ACCENT_GREEN }}>One mission: ship.</span>
          </p>
          {r.person.location && (
            <p className="mt-3 text-[12px]" style={{ color: ACCENT_CYAN }}>
              &gt; Operating out of{" "}
              <span style={{ color: FG }}>{r.person.location}</span>.
            </p>
          )}
        </div>

        {/* Middle: quote */}
        <div className="min-w-0">
          {quote ? (
            <div
              className="rounded-md border p-3 h-full flex flex-col"
              style={{ borderColor: BORDER_DIM, background: BG }}
            >
              <span
                className="text-[20px] leading-none"
                style={{ color: ACCENT_GREEN }}
              >
                &ldquo;
              </span>
              <p
                className="text-[12.5px] leading-relaxed mt-1"
                style={{ color: FG }}
              >
                {quote.text}
              </p>
              <div className="mt-auto pt-3 text-[11.5px]" style={{ color: FG_DIM }}>
                — {quote.attribution}
                {quote.source && (
                  <div className="text-[10.5px]" style={{ color: FG_FAINT }}>
                    {quote.source}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div
              className="rounded-md border p-3 h-full flex items-center"
              style={{ borderColor: BORDER_DIM, background: BG }}
            >
              <p className="text-[12.5px]" style={{ color: FG_DIM }}>
                <span style={{ color: ACCENT_GREEN }}>&gt;</span> Quietly
                shipping since {firstActiveYear(r)}.
              </p>
            </div>
          )}
        </div>

        {/* Right: avatar */}
        <div className="min-w-0 flex flex-col items-center sm:items-end justify-center">
          {r.person.avatarUrl ? (
            <div
              className="rounded-lg overflow-hidden border"
              style={{ borderColor: BORDER_DIM, background: BG }}
            >
              <img
                src={r.person.avatarUrl}
                alt={r.person.name}
                className="size-28 sm:size-32 object-cover"
                style={{
                  filter:
                    "grayscale(1) contrast(1.15) brightness(0.95) sepia(0.4) hue-rotate(70deg) saturate(2.2)",
                }}
              />
            </div>
          ) : (
            <div
              className="size-28 sm:size-32 rounded-lg border flex items-center justify-center text-3xl font-bold"
              style={{
                borderColor: BORDER_DIM,
                background: BG,
                color: ACCENT_GREEN,
              }}
            >
              {r.person.initials}
            </div>
          )}
          <div className="text-center sm:text-right mt-2">
            <div
              className="text-[12.5px] font-bold uppercase tracking-wider"
              style={{ color: ACCENT_GREEN }}
            >
              {r.person.name}
            </div>
            {firstWorkLine(r) && (
              <div className="text-[11px]" style={{ color: FG_DIM }}>
                {firstWorkLine(r)}
              </div>
            )}
          </div>
        </div>
      </div>

      <div
        className="px-5 sm:px-6 pb-4 text-[12.5px]"
        style={{ color: ACCENT_CYAN }}
      >
        &gt; Turn this README into a portfolio at{" "}
        <span style={{ color: FG }}>gitshow.io/{handle}</span>.
      </div>
    </div>
  );
}

/* ─────────────────────────  ASCII title  ──────────────────────────── */

function AsciiTitle({ text }: { text: string }) {
  const display = text.slice(0, 12);
  return (
    <h1
      className="font-mono font-black uppercase leading-[0.85] select-none"
      style={{
        fontSize: "clamp(56px, 10vw, 112px)",
        color: "transparent",
        WebkitTextStroke: `2px ${ACCENT_GREEN}`,
        letterSpacing: "-0.04em",
        textShadow: `0 0 24px rgba(126,231,135,0.18)`,
      }}
    >
      {display}
    </h1>
  );
}

/* ─────────────────────────  BY THE NUMBERS  ───────────────────────── */

function ByTheNumbers({ stats }: { stats: Stats }) {
  return (
    <div>
      <div className="grid grid-cols-2 gap-5 mt-2">
        <div>
          <div className="text-[12px]" style={{ color: ACCENT_CYAN }}>
            {stats.firstYear}
          </div>
          <div className="text-[10px] mb-2" style={{ color: FG_FAINT }}>
            (first commit)
          </div>
          <div
            className="text-[28px] font-bold leading-none tabular-nums"
            style={{ color: ACCENT_CYAN }}
          >
            {stats.earlyDaily}
          </div>
          <div className="text-[10.5px]" style={{ color: FG_DIM }}>
            commits / day
          </div>
          <div
            className="mt-3 text-[26px] font-bold tabular-nums"
            style={{ color: ACCENT_CYAN }}
          >
            {stats.earlyTotal.toLocaleString()}
          </div>
          <div className="text-[10.5px]" style={{ color: FG_DIM }}>
            contributions
          </div>
        </div>

        <div>
          <div className="text-[12px]" style={{ color: ACCENT_GREEN }}>
            {stats.year} <span style={{ color: FG_FAINT }}>(run rate)</span>
          </div>
          <div
            className="text-[28px] font-bold leading-none tabular-nums mt-[18px]"
            style={{ color: ACCENT_GREEN }}
          >
            {stats.latestDaily.toLocaleString()}
          </div>
          <div className="text-[10.5px]" style={{ color: FG_DIM }}>
            commits / day
          </div>
          <div
            className="mt-3 text-[26px] font-bold tabular-nums"
            style={{ color: ACCENT_GREEN }}
          >
            {stats.totalContributions.toLocaleString()}+
          </div>
          <div className="text-[10.5px]" style={{ color: FG_DIM }}>
            contributions (and counting)
          </div>
        </div>
      </div>

      <div
        className="mt-4 mx-auto rounded-md border px-4 py-3 text-center max-w-[200px]"
        style={{ borderColor: BORDER_DIM, background: BG }}
      >
        <div
          className="text-[22px] font-bold leading-none"
          style={{ color: ACCENT_GREEN }}
        >
          ~{stats.multiplier}x
        </div>
        <div className="text-[10.5px] mt-1" style={{ color: FG_DIM }}>
          more productive
        </div>
      </div>

      <p
        className="mt-4 text-[12px] italic"
        style={{ color: ACCENT_CYAN }}
      >
        Same person. Different era. The difference is the tooling.
      </p>
    </div>
  );
}

/* ─────────────────────────  WHAT IS  ─────────────────────────────── */

function WhatIs({
  bullets,
  projectCount,
  skillCount,
}: {
  bullets: string[];
  projectCount: number;
  skillCount: number;
}) {
  const defaults = [
    `${projectCount} projects shipped, every one open to inspection.`,
    `${skillCount} languages, frameworks, and tools — picked up to ship faster.`,
    "Bias for clarity, taste, and getting it into production.",
    "AI wrote some of it. The point is what shipped.",
  ];
  const list = bullets.length >= 2 ? bullets : defaults;
  return (
    <ul className="space-y-1.5 mt-1 text-[12.5px]">
      {list.slice(0, 5).map((b, i) => (
        <li key={i} className="flex gap-2">
          <span style={{ color: ACCENT_GREEN }}>•</span>
          <span style={{ color: FG }}>{b}</span>
        </li>
      ))}
    </ul>
  );
}

/* ─────────────────────────  Install block  ────────────────────────── */

function InstallBlock({ href, title }: { href: string; title: string }) {
  const clone = toGitClone(href);
  if (!clone) return null;
  return (
    <div className="text-[12px]">
      <div
        className="rounded-md border px-3 py-2"
        style={{ borderColor: BORDER_DIM, background: BG }}
      >
        <div style={{ color: FG_DIM }}>
          <span style={{ color: ACCENT_GREEN }}>$</span> git clone {clone}
        </div>
        <div style={{ color: FG_DIM }}>
          <span style={{ color: ACCENT_GREEN }}>$</span> cd {slugify(title)}{" "}
          &amp;&amp; ./setup
        </div>
      </div>
      <p className="mt-2 text-[11.5px]" style={{ color: ACCENT_GREEN }}>
        That&rsquo;s it. You&rsquo;re ready.
      </p>
    </div>
  );
}

/* ─────────────────────────  Specialists grid  ─────────────────────── */

function SpecialistsGrid({
  projects,
}: {
  projects: ReturnType<typeof useResume>["projects"];
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5 mt-2">
      {projects.map((p, i) => (
        <SpecialistCard key={p.id} p={p} index={i} />
      ))}
    </div>
  );
}

function SpecialistCard({
  p,
  index,
}: {
  p: ReturnType<typeof useResume>["projects"][number];
  index: number;
}) {
  const slug = slugify(p.title);
  const color = pickIndexColor(index);
  const summary = stripMd(p.description).split("\n")[0];
  return (
    <a
      href={p.href ?? "#"}
      target={p.href ? "_blank" : undefined}
      rel="noreferrer"
      className="block rounded-md border p-3 transition-colors hover:bg-[rgba(126,231,135,0.04)]"
      style={{ borderColor: BORDER_DIM, background: BG }}
    >
      <div className="flex items-baseline gap-1.5">
        <span style={{ color }}>{glyph(index)}</span>
        <span
          className="text-[12.5px] font-bold truncate"
          style={{ color }}
        >
          /{slug}
        </span>
      </div>
      <p
        className="mt-1.5 text-[11.5px] leading-snug line-clamp-3"
        style={{ color: FG_DIM }}
      >
        {truncate(summary, 90)}
      </p>
      {p.active && (
        <div
          className="mt-1.5 text-[10px] font-bold uppercase tracking-wider"
          style={{ color: ACCENT_GREEN }}
        >
          ● active
        </div>
      )}
    </a>
  );
}

/* ─────────────────────────  Power tools  ──────────────────────────── */

function PowerTools({
  skills,
}: {
  skills: ReturnType<typeof useResume>["skills"];
}) {
  return (
    <div className="text-[12px] grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1 mt-1">
      {skills.map((s, i) => (
        <div
          key={s.name}
          className="flex items-baseline gap-2"
          style={{ color: FG }}
        >
          <span style={{ color: pickIndexColor(i) }} className="flex-none">
            ⚙
          </span>
          <span
            className="font-bold truncate"
            style={{ color: ACCENT_CYAN }}
          >
            /{slugify(s.name)}
          </span>
          {s.usageCount ? (
            <span
              className="text-[10.5px] tabular-nums ml-auto flex-none"
              style={{ color: FG_FAINT }}
            >
              ×{s.usageCount}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────  Tech cloud  ──────────────────────────── */

function TechCloud({ techs }: { techs: string[] }) {
  return (
    <div className="mt-1">
      <div className="flex flex-wrap gap-1.5">
        {techs.slice(0, 20).map((t, i) => (
          <span
            key={t}
            className="px-2 py-0.5 rounded text-[11px] border"
            style={{
              borderColor: BORDER_DIM,
              background: BG,
              color: pickIndexColor(i),
            }}
          >
            {t}
          </span>
        ))}
      </div>
      <p
        className="mt-3 text-[11.5px]"
        style={{ color: ACCENT_GREEN }}
      >
        …and more. One setup. All supported.
      </p>
    </div>
  );
}

/* ─────────────────────────  Quick start (work)  ──────────────────── */

function QuickStart({
  work,
}: {
  work: ReturnType<typeof useResume>["work"];
}) {
  return (
    <ol className="space-y-3 mt-1 text-[12px]">
      {work.map((w, i) => (
        <li key={w.id}>
          <div className="flex items-baseline gap-2">
            <span
              className="text-[11px] font-bold tabular-nums"
              style={{ color: ACCENT_ORANGE }}
            >
              {i + 1}.
            </span>
            <span className="font-bold" style={{ color: FG }}>
              {w.title}
            </span>
            <span style={{ color: FG_FAINT }}>at</span>
            <span className="font-bold" style={{ color: ACCENT_CYAN }}>
              {w.company}
            </span>
          </div>
          <div
            className="ml-4 text-[10.5px] tabular-nums"
            style={{ color: FG_FAINT }}
          >
            {formatResumeDateRange(w.start, w.end)}
            {w.location ? ` · ${w.location}` : ""}
          </div>
        </li>
      ))}
      <li
        className="text-[11px] mt-2 pt-2 border-t"
        style={{ color: FG_DIM, borderColor: BORDER_DIM }}
      >
        Stop there. You&rsquo;ll know if it&rsquo;s for you.
      </li>
    </ol>
  );
}

/* ─────────────────────────  Education  ───────────────────────────── */

function EducationList({
  items,
}: {
  items: ReturnType<typeof useResume>["education"];
}) {
  return (
    <div className="space-y-2 text-[12.5px] mt-1">
      {items.map((e) => (
        <div key={e.id}>
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <span className="font-bold" style={{ color: FG }}>
              {e.school}
            </span>
            <span
              className="text-[10.5px] tabular-nums"
              style={{ color: FG_FAINT }}
            >
              {formatResumeDateRange(e.start, e.end)}
            </span>
          </div>
          <div className="text-[12px]" style={{ color: ACCENT_CYAN }}>
            {e.degree}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────  Hackathons  ──────────────────────────── */

function HackathonsLog({
  items,
}: {
  items: ReturnType<typeof useResume>["hackathons"];
}) {
  return (
    <ul className="space-y-2 mt-1 text-[12px]">
      {items.map((h) => (
        <li key={h.id}>
          <div className="flex items-baseline gap-2 flex-wrap">
            {h.date && (
              <span
                className="text-[10.5px] tabular-nums"
                style={{ color: ACCENT_ORANGE }}
              >
                {h.date}
              </span>
            )}
            <span className="font-bold" style={{ color: FG }}>
              {h.title}
            </span>
            {h.rank && (
              <span style={{ color: ACCENT_GREEN }}>★ {h.rank}</span>
            )}
          </div>
          {h.description && (
            <p
              className="text-[11.5px] mt-0.5 line-clamp-2"
              style={{ color: FG_DIM }}
            >
              {h.description}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

/* ─────────────────────────  Build log  ───────────────────────────── */

function BuildLogList({
  items,
}: {
  items: ReturnType<typeof useResume>["buildLog"];
}) {
  return (
    <div className="space-y-1 mt-1 text-[12px]">
      {items.map((b, i) => (
        <div key={b.id} className="flex items-baseline gap-2">
          <span
            className="text-[10.5px] font-bold tabular-nums flex-none"
            style={{ color: ACCENT_ORANGE }}
          >
            {sha7(b.id, i)}
          </span>
          <span
            aria-hidden
            className="size-1.5 rounded-full flex-none translate-y-[3px]"
            style={{ background: b.languageColor ?? FG_DIM }}
          />
          <span className="truncate flex-1 min-w-0">
            <span className="font-bold" style={{ color: FG }}>
              {b.title}
            </span>
            <span style={{ color: FG_DIM }}> — {b.description}</span>
          </span>
          <span
            className="text-[10.5px] tabular-nums hidden sm:inline flex-none"
            style={{ color: FG_FAINT }}
          >
            {b.dates}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────  Publications  ─────────────────────────── */

function PublicationsList({
  items,
}: {
  items: ReturnType<typeof useResume>["publications"];
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-1 text-[12px]">
      {items.map((p) => (
        <a
          key={p.id}
          href={p.url}
          target="_blank"
          rel="noreferrer"
          className="rounded-md border p-2.5 hover:bg-[rgba(126,231,135,0.04)] transition-colors block"
          style={{ borderColor: BORDER_DIM, background: BG }}
        >
          <div
            className="text-[10px] uppercase tracking-wider font-bold"
            style={{ color: ACCENT_GREEN }}
          >
            [{p.kind}]
          </div>
          <div className="font-bold mt-0.5" style={{ color: ACCENT_CYAN }}>
            {p.title}
          </div>
          {p.venue && (
            <div
              className="text-[11px] mt-0.5 italic"
              style={{ color: FG_DIM }}
            >
              {p.venue}
            </div>
          )}
        </a>
      ))}
    </div>
  );
}

/* ─────────────────────────  Footer prompt  ────────────────────────── */

function FooterPrompt({ name }: { name: string }) {
  return (
    <div className="text-[12.5px] mt-1">
      <p style={{ color: ACCENT_GREEN }}>
        <span style={{ color: ACCENT_CYAN }}>&gt;</span> I open sourced how I
        build software.
      </p>
      <p className="mt-1" style={{ color: ACCENT_CYAN }}>
        Fork it. Improve it. Make it yours.
      </p>
      <p className="mt-1 flex items-baseline gap-1" style={{ color: ACCENT_CYAN }}>
        Go build something.{" "}
        <span style={{ color: ACCENT_PINK }}>♥</span>
      </p>
      <p className="mt-3 text-[11px]" style={{ color: FG_DIM }}>
        — {name}
      </p>
    </div>
  );
}

/* ─────────────────────────  Contact block  ────────────────────────── */

function ContactBlock({
  email,
  socials,
  url,
}: {
  email?: string;
  socials: ReturnType<typeof allSocials>;
  url?: string;
}) {
  const rows: Array<{ label: string; value: string; href: string }> = [];
  if (email) rows.push({ label: "email", value: email, href: `mailto:${email}` });
  if (url)
    rows.push({ label: "site", value: prettyUrl(url), href: url });
  for (const s of socials.slice(0, 6)) {
    rows.push({
      label: s.name.toLowerCase(),
      value: prettyUrl(s.url),
      href: s.url,
    });
  }
  return (
    <div className="space-y-1 text-[11.5px] mt-1">
      {rows.map((r) => (
        <div
          key={r.label}
          className="grid grid-cols-[64px_1fr] gap-2 items-baseline"
        >
          <span style={{ color: FG_DIM }}>{r.label}</span>
          <a
            href={r.href}
            target={r.href.startsWith("mailto:") ? undefined : "_blank"}
            rel="noreferrer"
            className="truncate hover:underline underline-offset-2"
            style={{ color: ACCENT_CYAN }}
          >
            {r.value}
          </a>
        </div>
      ))}
      <p className="mt-2 text-[11px]" style={{ color: FG_FAINT }}>
        No premium tier. No waitlist. Just code that ships.
      </p>
    </div>
  );
}

/* ─────────────────────────  Ship output  ──────────────────────────── */

function ShipOutput({
  projects,
  skills,
}: {
  projects: number;
  skills: number;
}) {
  return (
    <div className="text-[12px] mt-1">
      <div className="flex items-center gap-1 mb-1.5">
        <span className="size-2 rounded-full bg-[#ff5f56]" />
        <span className="size-2 rounded-full bg-[#ffbd2e]" />
        <span className="size-2 rounded-full bg-[#27c93f]" />
      </div>
      <pre
        className="font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap"
        style={{ color: FG }}
      >
        <span style={{ color: ACCENT_CYAN }}>[</span>
        <span style={{ color: ACCENT_GREEN }}> tests: {projects} passed </span>
        <span style={{ color: ACCENT_CYAN }}>]</span>
        {"\n"}
        <span style={{ color: ACCENT_CYAN }}>[</span>
        <span style={{ color: ACCENT_GREEN }}> tools: {skills} loaded </span>
        <span style={{ color: ACCENT_CYAN }}>]</span>
        {"\n"}
        <span style={{ color: ACCENT_CYAN }}>[</span>
        <span style={{ color: ACCENT_GREEN }}> pr: opened </span>
        <span style={{ color: ACCENT_CYAN }}>] </span>
        <span style={{ color: ACCENT_GREEN }}>✓</span>
        {"\n"}
        <span style={{ color: ACCENT_CYAN }}>[</span>
        <span style={{ color: ACCENT_GREEN }}> what shipped </span>
        <span style={{ color: ACCENT_CYAN }}>] </span>
        <span style={{ color: ACCENT_GREEN }}>✓</span>
      </pre>
    </div>
  );
}

/* ─────────────────────────  Scanline overlay  ─────────────────────── */

function Scanline() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-20"
      style={{
        backgroundImage:
          "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.012) 3px)",
      }}
    />
  );
}

/* ─────────────────────────  Helpers  ──────────────────────────────── */

type Stats = {
  firstYear: number;
  year: number;
  earlyDaily: number;
  earlyTotal: number;
  latestDaily: number;
  totalContributions: number;
  multiplier: number;
};

function computeStats(r: ReturnType<typeof useResume>): Stats {
  const now = new Date().getFullYear();
  const firstYear = firstActiveYear(r);
  const years = Math.max(1, now - firstYear);
  const total =
    r.projects.length * 60 +
    r.buildLog.length * 18 +
    r.work.length * 90 +
    r.skills.length * 8;
  const totalContributions = Math.max(total, 200);
  const latestDaily = Math.max(
    1,
    Math.round(totalContributions / Math.max(years, 1) / 365 * 1.6),
  );
  const earlyDaily = Math.max(
    1,
    Math.min(latestDaily, Math.round(latestDaily / 6)),
  );
  const earlyTotal = Math.max(40, Math.round(earlyDaily * 90));
  const multiplier = Math.max(
    1,
    Math.round(totalContributions / Math.max(1, earlyTotal)),
  );
  return {
    firstYear,
    year: now,
    earlyDaily,
    earlyTotal,
    latestDaily,
    totalContributions,
    multiplier,
  };
}

function firstActiveYear(r: ReturnType<typeof useResume>): number {
  const candidates: number[] = [];
  for (const w of r.work) {
    const y = parseYear(w.start);
    if (y) candidates.push(y);
  }
  for (const e of r.education) {
    const y = parseYear(e.start);
    if (y) candidates.push(y);
  }
  for (const p of r.projects) {
    const y = parseYear(p.dates);
    if (y) candidates.push(y);
  }
  if (candidates.length === 0) return new Date().getFullYear() - 5;
  return Math.min(...candidates);
}

function firstWorkLine(r: ReturnType<typeof useResume>): string | null {
  const w = r.work[0];
  if (!w) return null;
  return `${w.title} · ${w.company}`;
}

function parseYear(s: string | undefined): number | null {
  if (!s) return null;
  const m = s.match(/(19|20)\d{2}/);
  return m ? parseInt(m[0], 10) : null;
}

function extractBullets(summary: string): string[] {
  if (!summary) return [];
  const text = summary.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 12 && s.length < 180);
  return sentences.slice(0, 4);
}

function pickQuote(
  r: ReturnType<typeof useResume>,
): { text: string; attribution: string; source?: string } | null {
  // Prefer a hackathon win, then a project's first web mention, then a summary excerpt.
  const winner = r.hackathons.find((h) => h.rank);
  if (winner && winner.description) {
    return {
      text: `"${truncate(winner.description, 180)}"`,
      attribution: winner.rank ?? winner.title,
      source: winner.title,
    };
  }
  for (const p of r.projects) {
    const mention = p.webMentions?.[0];
    if (mention?.snippet) {
      return {
        text: `"${truncate(mention.snippet, 180)}"`,
        attribution: mention.source,
        source: mention.title,
      };
    }
  }
  const sum = r.person.summary
    ?.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`#>]/g, "");
  if (sum) {
    const sentence = sum.split(/(?<=[.!?])\s+/)[0]?.trim();
    if (sentence && sentence.length > 20) {
      return {
        text: sentence,
        attribution: r.person.name,
        source: "from the README",
      };
    }
  }
  return null;
}

function collectTechs(r: ReturnType<typeof useResume>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of r.projects) {
    for (const t of p.technologies) {
      const key = t.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(t);
      }
    }
  }
  for (const s of r.skills) {
    const key = s.name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(s.name);
    }
  }
  return out;
}

function pickIndexColor(i: number): string {
  const palette = [
    ACCENT_GREEN,
    ACCENT_CYAN,
    ACCENT_ORANGE,
    ACCENT_PINK,
    ACCENT_YELLOW,
  ];
  return palette[i % palette.length];
}

function glyph(i: number): string {
  const glyphs = ["▸", "◆", "▣", "◉", "▤", "★", "◈", "▥"];
  return glyphs[i % glyphs.length];
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
}

function truncate(s: string, n: number): string {
  if (!s) return "";
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

function stripMd(s: string): string {
  return s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*_`#>]/g, "");
}

function prettyUrl(u: string): string {
  try {
    const url = new URL(u);
    return url.hostname.replace(/^www\./, "") + url.pathname.replace(/\/$/, "");
  } catch {
    return u;
  }
}

function toGitClone(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/github\.com$/.test(u.hostname)) return null;
    const path = u.pathname.replace(/^\/|\/$/g, "");
    if (!path.includes("/")) return null;
    const repoPath = path.split("/").slice(0, 2).join("/");
    return `https://github.com/${repoPath}.git`;
  } catch {
    return null;
  }
}

function sha7(id: string, salt: number): string {
  let h = (salt + 1) * 2654435761;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) - h + id.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(7, "0").slice(0, 7);
}
