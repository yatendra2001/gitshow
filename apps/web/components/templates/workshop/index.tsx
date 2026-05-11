/* eslint-disable @next/next/no-img-element */
"use client";

import { useMemo } from "react";
import { useResume, useHandle } from "@/components/data-provider";
import ContributionTrend from "@/components/contribution-trend";
import { resolveSkillIcon } from "@/components/skill-icons";
import { allSocials } from "@gitshow/shared/resume";
import { formatResumeDateRange } from "@/lib/format-date";

/**
 * Workshop — a portfolio that reads like an open-source README poster.
 *
 * Dashboard-density: one dashed-green outer frame, a tight hero band
 * (ASCII title | meta block | quote+avatar) on a single row, then a
 * grid of bordered panels (BY THE NUMBERS, WHAT IS, INSTALL,
 * SPECIALISTS, POWER TOOLS, WORKS WITH, QUICK START, footer). Maps
 * the user's resume onto the founder's-README poster aesthetic.
 */

// ─────────────────────────  Palette  ─────────────────────────
// True-black bg (no blue cast). Single background everywhere — panels
// and insets share the page background; borders alone define structure.
// Section header color varies by panel purpose: AMBER for state/metric,
// CYAN for list/inventory.
const BG = "#0a0a0a";
const BG_CARD = BG;
const BG_INSET = BG;
const FRAME = "rgba(126, 231, 135, 0.32)";
const PANEL_BORDER = "rgba(126, 231, 135, 0.18)";
const ACCENT_GREEN = "#7ee787";
const ACCENT_CYAN = "#79c0ff";
const ACCENT_AMBER = "#f9e2af";
const ACCENT_ORANGE = "#ffa657";
const ACCENT_PINK = "#f778ba";
const ACCENT_RED = "#ff7b72";
const FG = "#e6edf3";
const FG_DIM = "#9d9d9d";
const FG_FAINT = "#787878";

export default function WorkshopTemplate() {
  const r = useResume();
  const handle = useHandle();
  const hidden = new Set(r.sections.hidden);
  const socials = allSocials(r);

  const stats = useMemo(() => computeStats(r), [r]);
  const quote = useMemo(() => pickQuote(r), [r]);
  const techs = useMemo(() => collectTechs(r), [r]);

  return (
    <div
      className="min-h-dvh font-mono antialiased"
      style={{
        background: BG,
        color: FG,
        fontSize: "13px",
        lineHeight: "1.55",
      }}
    >
      <Scanline />

      <div className="mx-auto max-w-[1180px] px-3 sm:px-5 py-5 sm:py-7">
        <Frame>
          <PromptLine handle={handle} />

          <Hero r={r} handle={handle} quote={quote} />

          <TurnLine handle={handle} />

          {/* Row 2: stats | (currently + GH contributions) */}
          <div className="mt-4 grid grid-cols-1 lg:grid-cols-[1.45fr_1fr] gap-3">
            <Panel
              title="⚡ BY THE NUMBERS"
              subtitle="(measured on logical code)"
              titleColor={ACCENT_AMBER}
            >
              <ByTheNumbers stats={stats} />
            </Panel>

            <div className="flex flex-col gap-3 min-w-0">
              <Panel title="$ CURRENTLY" titleColor={ACCENT_AMBER}>
                <CurrentlyBlock r={r} />
              </Panel>

              <Panel
                title="> GH CONTRIBUTIONS"
                subtitle="(streamed live · github.com)"
                titleColor={ACCENT_AMBER}
              >
                <ContributionTrendInline handle={handle} />
              </Panel>
            </div>
          </div>

          {/* Featured projects */}
          {!hidden.has("projects") && r.projects.length > 0 && (
            <div className="mt-4">
              <Panel
                title={`> ${r.projects.length} ${
                  r.projects.length === 1 ? "PROJECT" : "PROJECTS"
                } SHIPPED`}
                subtitle="(highlight reel)"
              >
                <ProjectsGrid projects={r.projects} />
              </Panel>
            </div>
          )}

          {/* Tools row — auto-shrinks to the number of visible panels */}
          <AdaptiveRow
            panels={[
              !hidden.has("skills") && r.skills.length > 0 ? (
                <Panel
                  key="skills"
                  title={`> ${r.skills.length} TOOLS IN ROTATION`}
                  subtitle="(daily drivers)"
                >
                  <PowerTools skills={r.skills} />
                </Panel>
              ) : null,
              techs.length > 0 ? (
                <Panel
                  key="tech"
                  title="> TECH STACK"
                  subtitle={`(${techs.length}+ in production)`}
                >
                  <TechGrid techs={techs} />
                </Panel>
              ) : null,
              !hidden.has("work") && r.work.length > 0 ? (
                <Panel key="career" title="> CAREER" subtitle="(timeline)">
                  <CareerTimeline work={r.work} />
                </Panel>
              ) : null,
            ]}
          />

          {/* Optional row: education + hackathons + buildLog */}
          <AdaptiveRow
            panels={[
              !hidden.has("education") && r.education.length > 0 ? (
                <Panel key="edu" title="> EDUCATION">
                  <EducationList items={r.education} />
                </Panel>
              ) : null,
              !hidden.has("hackathons") && r.hackathons.length > 0 ? (
                <Panel
                  key="hack"
                  title="> HACKATHON LOG"
                  subtitle={`(${r.hackathons.length})`}
                >
                  <HackathonsLog items={r.hackathons.slice(0, 5)} />
                </Panel>
              ) : null,
              !hidden.has("buildLog") && r.buildLog.length > 0 ? (
                <Panel
                  key="git"
                  title="> GIT LOG"
                  subtitle={`(${r.buildLog.length})`}
                >
                  <BuildLogList items={r.buildLog.slice(0, 6)} />
                </Panel>
              ) : null,
            ]}
          />

          {/* Footer row */}
          <div className="mt-4 grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr_1fr] gap-3 pb-1">
            <Manifesto name={r.person.name} />
            <ContactCard
              email={r.contact.email}
              socials={socials}
              url={r.person.url}
            />
            <ShipTerminal handle={handle} stats={stats} />
          </div>
        </Frame>
      </div>
    </div>
  );
}

/* ─────────────────────────  Frame  ─────────────────────────── */

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-xl p-4 sm:p-5"
      style={{
        border: `1px dashed ${FRAME}`,
        background: BG,
        boxShadow:
          "0 0 0 1px rgba(126,231,135,0.04) inset, 0 30px 80px -30px rgba(0,0,0,0.6)",
      }}
    >
      {children}
    </div>
  );
}

/* ─────────────────────────  AdaptiveRow  ─────────────────────
 *
 * Row of optional panels that collapses to the number of visible
 * children. Avoids the "ghost column" bug where a fixed `grid-cols-3`
 * leaves a blank slot when some sections are empty or hidden (e.g.
 * no hackathons → 3rd column floats empty next to GIT LOG).
 *
 * Stays single-column on mobile; at ≥lg it uses the exact number
 * of visible panels as its column count. Tailwind class strings
 * are inlined so the JIT picks them up. */
function AdaptiveRow({ panels }: { panels: Array<React.ReactNode | false | null> }) {
  const visible = panels.filter(Boolean);
  if (visible.length === 0) return null;

  const colsClass =
    visible.length === 1
      ? ""
      : visible.length === 2
        ? "lg:grid-cols-2"
        : "lg:grid-cols-3";

  return (
    <div className={`mt-4 grid grid-cols-1 ${colsClass} gap-3`}>
      {visible}
    </div>
  );
}

/* ─────────────────────────  Panel  ─────────────────────────── */

function Panel({
  title,
  subtitle,
  titleColor,
  children,
}: {
  title: string;
  subtitle?: string;
  titleColor?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="rounded-md min-w-0"
      style={{
        border: `1px solid ${PANEL_BORDER}`,
        background: BG_CARD,
      }}
    >
      <header className="px-3 pt-2.5 pb-1.5 flex items-baseline gap-2 flex-wrap">
        <span
          className="text-[12px] font-bold tracking-wider"
          style={{ color: titleColor ?? ACCENT_CYAN }}
        >
          {title}
        </span>
        {subtitle && (
          <span className="text-[11px]" style={{ color: FG_FAINT }}>
            {subtitle}
          </span>
        )}
      </header>
      <div className="px-3 pb-3">{children}</div>
    </section>
  );
}

/* ─────────────────────────  Prompt line  ────────────────────── */

function PromptLine({ handle }: { handle: string }) {
  return (
    <div className="text-[12px] mb-3 flex items-center">
      <span style={{ color: ACCENT_CYAN }}>{handle}</span>
      <span style={{ color: FG_FAINT }}>@</span>
      <span style={{ color: ACCENT_ORANGE }}>workshop</span>
      <span style={{ color: FG_FAINT }}>:~$ </span>
      <span style={{ color: FG }} className="ml-1">cat README.md</span>
    </div>
  );
}

/* ─────────────────────────  Hero  ────────────────────────────── */

function Hero({
  r,
  handle,
  quote,
}: {
  r: ReturnType<typeof useResume>;
  handle: string;
  quote: { text: string; attribution: string; source?: string } | null;
}) {
  const firstWork = r.work[0];
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1.25fr_1fr_1fr] gap-4 lg:gap-6 items-start">
      {/* Title */}
      <div className="min-w-0">
        <AsciiTitle text={handle} />
      </div>

      {/* Meta block — portfolio facts, not "power tools / ship" copy */}
      <div className="min-w-0 text-[14px] leading-snug pt-1">
        <div style={{ color: ACCENT_CYAN }}>
          {truncate(r.person.description, 90)}
        </div>
        <div className="mt-3 space-y-0.5" style={{ color: FG }}>
          {r.projects.length > 0 && (
            <div>
              {r.projects.length}{" "}
              {r.projects.length === 1 ? "project" : "projects"} shipped.
            </div>
          )}
          {(() => {
            const years = Math.max(1, new Date().getFullYear() - firstActiveYear(r));
            return (
              <div>
                {years} {years === 1 ? "year" : "years"} building.
              </div>
            );
          })()}
          {firstWork && (
            <div>
              Currently:{" "}
              <span style={{ color: ACCENT_GREEN }}>
                {truncate(`${firstWork.title} @ ${firstWork.company}`, 42)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Quote + avatar column */}
      <div className="min-w-0 flex flex-col gap-3">
        {quote && (
          <div
            className="rounded-md p-3 text-[12px]"
            style={{
              border: `1px solid ${PANEL_BORDER}`,
              background: BG_INSET,
            }}
          >
            <div
              className="text-[22px] leading-none -mb-1"
              style={{ color: ACCENT_GREEN }}
            >
              &ldquo;
            </div>
            <p style={{ color: FG }} className="leading-snug">
              {truncate(quote.text, 160)}
            </p>
            <div className="mt-2 text-[11px]" style={{ color: FG_DIM }}>
              — {quote.attribution}
            </div>
            {quote.source && (
              <div className="text-[10.5px]" style={{ color: FG_FAINT }}>
                {quote.source}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-3">
          {r.person.avatarUrl ? (
            <div
              className="rounded-md overflow-hidden flex-none"
              style={{
                border: `1px solid ${PANEL_BORDER}`,
                background: BG_INSET,
              }}
            >
              <img
                src={r.person.avatarUrl}
                alt={r.person.name}
                className="size-20 object-cover"
                style={{
                  filter: "grayscale(1) contrast(1.25) brightness(0.95)",
                  mixBlendMode: "screen",
                }}
              />
            </div>
          ) : (
            <div
              className="size-20 rounded-md flex items-center justify-center text-2xl font-bold flex-none"
              style={{
                border: `1px solid ${PANEL_BORDER}`,
                background: BG_INSET,
                color: ACCENT_GREEN,
              }}
            >
              {r.person.initials}
            </div>
          )}
          <div className="min-w-0">
            <div
              className="text-[13px] font-bold uppercase tracking-wider truncate"
              style={{ color: ACCENT_GREEN }}
            >
              {r.person.name}
            </div>
            {firstWork && (
              <div
                className="text-[11px] truncate"
                style={{ color: FG_DIM }}
              >
                {firstWork.title} · {firstWork.company}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────  ASCII title  ──────────────────────── */

function AsciiTitle({ text }: { text: string }) {
  const display = text.slice(0, 12);
  const len = display.length;
  // Scale the headline so the full handle fits on one line within its
  // ~32% hero column. Short handles get a poster-sized title; longer
  // handles auto-shrink so we never wrap mid-word.
  const fontSize =
    len <= 5
      ? "clamp(56px, 8.5vw, 104px)"
      : len <= 7
        ? "clamp(48px, 7vw, 80px)"
        : len <= 9
          ? "clamp(38px, 5.4vw, 64px)"
          : "clamp(30px, 4.4vw, 52px)";
  const strokeWidth = len <= 7 ? "1.5px" : "1.25px";
  return (
    <h1
      className="font-mono font-black leading-[0.85] select-none whitespace-nowrap"
      style={{
        fontSize,
        color: "transparent",
        WebkitTextStroke: `${strokeWidth} ${ACCENT_GREEN}`,
        letterSpacing: "-0.05em",
        textShadow: `0 0 16px rgba(126,231,135,0.15)`,
      }}
    >
      {display}
    </h1>
  );
}

/* ─────────────────────────  Turn line  ────────────────────────── */

function TurnLine({ handle }: { handle: string }) {
  return (
    <p className="mt-3 text-[13px]" style={{ color: ACCENT_CYAN }}>
      &gt; Turn this README into a portfolio at{" "}
      <span style={{ color: FG }}>gitshow.io/{handle}</span>.
    </p>
  );
}

/* ─────────────────────────  BY THE NUMBERS  ───────────────────── */

function ByTheNumbers({ stats }: { stats: Stats }) {
  return (
    <div className="pt-1">
      <div className="grid grid-cols-[1fr_auto_1fr] gap-x-3 sm:gap-x-5 items-center">
        {/* Past */}
        <div>
          <div className="text-[12px]" style={{ color: ACCENT_CYAN }}>
            {stats.firstYear}{" "}
            <span style={{ color: FG_FAINT }}>(first commit)</span>
          </div>
          <div
            className="text-[24px] sm:text-[26px] font-bold leading-none tabular-nums mt-2.5"
            style={{ color: ACCENT_CYAN }}
          >
            {stats.earlyDaily}
          </div>
          <div className="text-[10.5px] mt-0.5" style={{ color: FG_DIM }}>
            commits / day
          </div>
          <div
            className="text-[22px] sm:text-[24px] font-bold tabular-nums mt-2.5"
            style={{ color: ACCENT_CYAN }}
          >
            {stats.earlyTotal.toLocaleString()}
          </div>
          <div className="text-[10.5px] mt-0.5" style={{ color: FG_DIM }}>
            contributions
          </div>
        </div>

        {/* Multiplier pill — middle column, sits between the two stat stacks */}
        <div
          className="rounded-md px-3 py-2.5 text-center self-center"
          style={{
            border: `1px dashed ${ACCENT_AMBER}`,
            background: BG_INSET,
            minWidth: "92px",
          }}
        >
          <div
            className="text-[20px] font-bold leading-none tabular-nums"
            style={{ color: ACCENT_AMBER }}
          >
            ~{stats.multiplier}x
          </div>
          <div className="text-[10px] mt-1 leading-tight" style={{ color: FG_DIM }}>
            more
            <br />
            productive
          </div>
        </div>

        {/* Now */}
        <div>
          <div className="text-[12px]" style={{ color: ACCENT_GREEN }}>
            {stats.year} <span style={{ color: FG_FAINT }}>(run rate)</span>
          </div>
          <div
            className="text-[24px] sm:text-[26px] font-bold leading-none tabular-nums mt-2.5"
            style={{ color: ACCENT_GREEN }}
          >
            {stats.latestDaily.toLocaleString()}
          </div>
          <div className="text-[10.5px] mt-0.5" style={{ color: FG_DIM }}>
            commits / day
          </div>
          <div
            className="text-[22px] sm:text-[24px] font-bold tabular-nums mt-2.5"
            style={{ color: ACCENT_GREEN }}
          >
            {stats.totalContributions.toLocaleString()}+
          </div>
          <div className="text-[10.5px] mt-0.5" style={{ color: FG_DIM }}>
            contributions{" "}
            <span style={{ color: FG_FAINT }}>(and counting)</span>
          </div>
        </div>
      </div>

      <p className="mt-3 text-[12px] italic" style={{ color: ACCENT_CYAN }}>
        Same person. Different era. The difference is the tooling.
      </p>
    </div>
  );
}

/* ─────────────────────────  Currently block  ──────────────────── */

function CurrentlyBlock({ r }: { r: ReturnType<typeof useResume> }) {
  const job = r.work[0];
  const activeProject =
    r.projects.find((p) => p.active) ?? r.projects[0] ?? null;
  const rows: Array<{ key: string; value: React.ReactNode }> = [];
  if (job) {
    rows.push({
      key: "role",
      value: (
        <>
          <span style={{ color: FG }}>{job.title}</span>
          <span style={{ color: FG_FAINT }}> @ </span>
          <span style={{ color: ACCENT_CYAN }}>{job.company}</span>
        </>
      ),
    });
  }
  if (activeProject) {
    rows.push({
      key: "shipping",
      value: activeProject.href ? (
        <a
          href={activeProject.href}
          target="_blank"
          rel="noreferrer"
          style={{ color: ACCENT_CYAN }}
          className="hover:underline underline-offset-2 truncate"
        >
          {activeProject.title}
        </a>
      ) : (
        <span style={{ color: FG }}>{activeProject.title}</span>
      ),
    });
  }

  return (
    <div className="text-[11.5px]">
      <div
        className="rounded-sm px-2.5 py-2 space-y-0.5"
        style={{ background: BG_INSET, border: `1px solid ${PANEL_BORDER}` }}
      >
        {rows.map((row) => (
          <div key={row.key} className="grid grid-cols-[68px_1fr] gap-2">
            <span className="truncate" style={{ color: FG_DIM }}>
              {row.key}
            </span>
            <span className="truncate min-w-0">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────  Contribution chart inline  ─────────── */

function ContributionTrendInline({ handle }: { handle: string }) {
  return (
    <div className="pt-1">
      <ContributionTrend
        handle={handle}
        accent={ACCENT_GREEN}
        fg={FG}
        dim={FG_DIM}
        ghost="rgba(255,255,255,0.08)"
        cardBg="transparent"
        cardBorder="transparent"
        radius={0}
        chartHeight={70}
        pad={{ x: 0, y: 6 }}
        eyebrow="lifetime"
        caption="github.com"
        tooltipBg={BG}
        tooltipBorder={PANEL_BORDER}
      />
    </div>
  );
}

/* ─────────────────────────  Projects grid  ────────────────────── */

function ProjectsGrid({
  projects,
}: {
  projects: ReturnType<typeof useResume>["projects"];
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-x-4 gap-y-3 pt-1">
      {projects.map((p, i) => (
        <ProjectCell key={p.id} p={p} index={i} />
      ))}
    </div>
  );
}

function ProjectCell({
  p,
  index,
}: {
  p: ReturnType<typeof useResume>["projects"][number];
  index: number;
}) {
  const color = pickIndexColor(index);
  const summary = stripMd(p.description).split("\n")[0];
  return (
    <a
      href={p.href ?? "#"}
      target={p.href ? "_blank" : undefined}
      rel="noreferrer"
      className="block min-w-0 group"
    >
      <div className="flex items-baseline gap-1.5">
        <span
          className="text-[10px] flex-none translate-y-[-1px]"
          style={{ color: p.active ? ACCENT_GREEN : color }}
        >
          {p.active ? "●" : glyph(index)}
        </span>
        <span
          className="text-[12.5px] font-bold truncate group-hover:underline underline-offset-2"
          style={{ color }}
        >
          {p.title}
        </span>
      </div>
      <p
        className="mt-0.5 text-[11px] leading-snug line-clamp-2"
        style={{ color: FG_DIM }}
      >
        {truncate(summary, 80)}
      </p>
    </a>
  );
}

/* ─────────────────────────  Power tools  ──────────────────────── */

function PowerTools({
  skills,
}: {
  skills: ReturnType<typeof useResume>["skills"];
}) {
  return (
    <ul className="space-y-0.5 text-[11.5px] pt-1">
      {skills.slice(0, 12).map((s, i) => (
        <li key={s.name} className="flex items-baseline gap-2">
          <span
            style={{ color: pickIndexColor(i) }}
            className="flex-none text-[10px] translate-y-[-1px]"
          >
            ▸
          </span>
          <span
            className="font-bold truncate flex-none"
            style={{ color: ACCENT_CYAN, minWidth: "84px" }}
          >
            {s.name}
          </span>
          <span
            className="truncate flex-1 min-w-0"
            style={{ color: FG_DIM }}
          >
            {describeSkill(s.name, s.usageCount)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function describeSkill(name: string, count?: number): string {
  const n = name.toLowerCase();
  if (n.includes("typescript") || n === "ts") return "Strongly typed app code.";
  if (n.includes("react")) return "Component-first interfaces.";
  if (n.includes("next")) return "Full-stack app framework.";
  if (n.includes("python")) return "Tooling & data work.";
  if (n.includes("rust")) return "Systems-grade primitives.";
  if (n.includes("tailwind")) return "Atomic styling system.";
  if (n.includes("postgres") || n.includes("sql")) return "Relational data.";
  if (n.includes("redis")) return "In-memory state.";
  if (n.includes("docker")) return "Reproducible containers.";
  if (n.includes("kuber") || n === "k8s") return "Orchestrated workloads.";
  if (n.includes("cloudflare")) return "Edge runtime + R2 + D1.";
  if (n.includes("aws") || n.includes("gcp") || n.includes("azure"))
    return "Cloud infrastructure.";
  if (n.includes("node")) return "Server-side runtime.";
  if (n.includes("bun")) return "Faster Node-shaped runtime.";
  if (n.includes("go") || n === "golang") return "Concurrent backends.";
  if (n.includes("swift")) return "Native iOS / macOS.";
  if (n.includes("kotlin")) return "Native Android / JVM.";
  if (n.includes("anthropic") || n.includes("claude"))
    return "Frontier LLM SDK.";
  if (n.includes("openai") || n.includes("gpt")) return "OpenAI-family models.";
  if (n.includes("vercel")) return "Frontend deploy target.";
  if (n.includes("fly")) return "Edge deploy target.";
  if (n.includes("supabase")) return "Postgres + auth + storage.";
  if (n.includes("prisma") || n.includes("drizzle")) return "Type-safe ORM.";
  return count ? `Used in ${count} repos.` : "Production-grade.";
}

/* ─────────────────────────  Tech grid (Works With)  ───────────── */

function TechGrid({ techs }: { techs: string[] }) {
  return (
    <div className="pt-1">
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
        {techs.slice(0, 12).map((t, i) => {
          const Icon = resolveSkillIcon(t);
          const tone = pickIndexColor(i);
          return (
            <div
              key={t}
              className="flex flex-col items-center justify-center gap-1 px-1 py-2 rounded-sm"
              style={{
                background: BG_INSET,
                border: `1px solid ${PANEL_BORDER}`,
                minHeight: "52px",
              }}
            >
              {Icon ? (
                <Icon
                  className="size-5"
                  style={{ color: FG }}
                  aria-hidden
                />
              ) : (
                <span
                  className="size-5 rounded-sm flex items-center justify-center text-[10px] font-bold"
                  style={{
                    background: `${tone}22`,
                    color: tone,
                  }}
                  aria-hidden
                >
                  {t.charAt(0).toUpperCase()}
                </span>
              )}
              <span
                className="text-[10px] truncate w-full text-center"
                style={{ color: FG_DIM }}
              >
                {truncate(t, 11)}
              </span>
            </div>
          );
        })}
      </div>
      <p
        className="text-[11px] mt-2 italic"
        style={{ color: ACCENT_GREEN }}
      >
        …and more. One setup. All supported.
      </p>
    </div>
  );
}

/* ─────────────────────────  Career timeline  ──────────────────── */

function CareerTimeline({
  work,
}: {
  work: ReturnType<typeof useResume>["work"];
}) {
  const recent = work.slice(0, 4);
  const current = work[0];
  return (
    <ol className="text-[11.5px] pt-1 space-y-2">
      {recent.map((w, i) => (
        <li key={w.id}>
          <div className="flex items-baseline gap-2 flex-wrap">
            <span
              className="text-[11px] font-bold tabular-nums flex-none"
              style={{ color: ACCENT_ORANGE }}
            >
              {i + 1}.
            </span>
            <span className="font-bold" style={{ color: FG }}>
              {w.title}
            </span>
            <span style={{ color: FG_FAINT }}>@</span>
            {w.href ? (
              <a
                href={w.href}
                target="_blank"
                rel="noreferrer"
                className="font-bold hover:underline underline-offset-2"
                style={{ color: ACCENT_CYAN }}
              >
                {w.company}
              </a>
            ) : (
              <span className="font-bold" style={{ color: ACCENT_CYAN }}>
                {w.company}
              </span>
            )}
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
        className="mt-2 pt-2 text-[10.5px]"
        style={{
          color: FG_DIM,
          borderTop: `1px solid ${PANEL_BORDER}`,
        }}
      >
        {current && /present/i.test(current.end) ? (
          <>
            Currently at{" "}
            <span style={{ color: ACCENT_CYAN }}>{current.company}</span>.
          </>
        ) : (
          "Open to what's next."
        )}
      </li>
    </ol>
  );
}

/* ─────────────────────────  Education  ────────────────────────── */

function EducationList({
  items,
}: {
  items: ReturnType<typeof useResume>["education"];
}) {
  return (
    <ul className="space-y-2 text-[11.5px] pt-1">
      {items.map((e) => (
        <li key={e.id}>
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <span className="font-bold" style={{ color: FG }}>
              {e.school}
            </span>
            <span className="text-[10.5px] tabular-nums" style={{ color: FG_FAINT }}>
              {formatResumeDateRange(e.start, e.end)}
            </span>
          </div>
          <div style={{ color: ACCENT_CYAN }}>{e.degree}</div>
        </li>
      ))}
    </ul>
  );
}

/* ─────────────────────────  Hackathons  ───────────────────────── */

function HackathonsLog({
  items,
}: {
  items: ReturnType<typeof useResume>["hackathons"];
}) {
  return (
    <ul className="space-y-2 text-[11.5px] pt-1">
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
            {h.rank && <span style={{ color: ACCENT_GREEN }}>★ {h.rank}</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ─────────────────────────  Build log  ────────────────────────── */

function BuildLogList({
  items,
}: {
  items: ReturnType<typeof useResume>["buildLog"];
}) {
  return (
    <ul className="space-y-0.5 text-[11.5px] pt-1">
      {items.map((b, i) => (
        <li key={b.id} className="flex items-baseline gap-2">
          <span
            className="text-[10.5px] font-bold tabular-nums flex-none"
            style={{ color: ACCENT_ORANGE }}
          >
            {sha7(b.id, i)}
          </span>
          <span
            aria-hidden
            className="size-1.5 rounded-full flex-none translate-y-[2px]"
            style={{ background: b.languageColor ?? FG_DIM }}
          />
          <span className="truncate flex-1 min-w-0" style={{ color: FG }}>
            {b.title}{" "}
            <span style={{ color: FG_DIM }}>— {b.description}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ─────────────────────────  Footer panels  ────────────────────── */

function Manifesto({ name }: { name: string }) {
  return (
    <section
      className="rounded-md min-w-0 px-3 py-3 flex items-start gap-3"
      style={{
        border: `1px solid ${PANEL_BORDER}`,
        background: BG_CARD,
      }}
    >
      <span
        className="text-[28px] leading-none font-bold flex-none"
        style={{ color: ACCENT_GREEN }}
      >
        &gt;
      </span>
      <div className="text-[12.5px] leading-snug">
        <p style={{ color: ACCENT_CYAN }}>
          I open sourced how I build software.
        </p>
        <p style={{ color: ACCENT_CYAN }}>
          Fork it. Improve it. Make it yours.
        </p>
        <p style={{ color: ACCENT_CYAN }}>
          Go build something.{" "}
          <span style={{ color: ACCENT_PINK }}>♥</span>
        </p>
        <p className="mt-2 text-[10.5px]" style={{ color: FG_FAINT }}>
          — {name}
        </p>
      </div>
    </section>
  );
}

function ContactCard({
  email,
  socials,
  url,
}: {
  email?: string;
  socials: ReturnType<typeof allSocials>;
  url?: string;
}) {
  const rows: Array<{ key: string; value: string; href: string }> = [];
  if (email) rows.push({ key: "email", value: email, href: `mailto:${email}` });
  if (url) rows.push({ key: "site", value: prettyUrl(url), href: url });
  for (const s of socials.slice(0, 4)) {
    if (s.url === url) continue;
    rows.push({
      key: s.name.toLowerCase(),
      value: prettyUrl(s.url),
      href: s.url,
    });
  }
  return (
    <section
      className="rounded-md min-w-0 px-3 py-3"
      style={{
        border: `1px solid ${PANEL_BORDER}`,
        background: BG_CARD,
      }}
    >
      <p
        className="text-[12px] font-bold tracking-wider"
        style={{ color: ACCENT_CYAN }}
      >
        &gt; SAY HI
      </p>
      <div className="mt-2 space-y-0.5 text-[11px]">
        {rows.slice(0, 5).map((row) => (
          <div
            key={row.key}
            className="grid grid-cols-[56px_1fr] gap-2 items-baseline"
          >
            <span className="truncate" style={{ color: FG_FAINT }}>
              {row.key}
            </span>
            <a
              href={row.href}
              target={row.href.startsWith("mailto:") ? undefined : "_blank"}
              rel="noreferrer"
              className="truncate hover:underline underline-offset-2"
              style={{ color: ACCENT_CYAN }}
            >
              {row.value}
            </a>
          </div>
        ))}
      </div>
      <p
        className="mt-2.5 text-[10.5px] leading-snug"
        style={{ color: FG_DIM }}
      >
        Always interested in a good build. Pitch me something.
      </p>
    </section>
  );
}

function ShipTerminal({
  handle,
  stats,
}: {
  handle: string;
  stats: Stats;
}) {
  const years = Math.max(1, stats.year - stats.firstYear);
  return (
    <section
      className="rounded-md min-w-0 overflow-hidden"
      style={{
        border: `1px solid ${PANEL_BORDER}`,
        background: BG_CARD,
      }}
    >
      <header
        className="px-3 py-1.5 flex items-center justify-between gap-2"
        style={{
          borderBottom: `1px solid ${PANEL_BORDER}`,
          background: BG_INSET,
        }}
      >
        <span className="text-[11px] truncate" style={{ color: FG_DIM }}>
          <span style={{ color: ACCENT_CYAN }}>{handle}</span>
          <span style={{ color: FG_FAINT }}>@</span>
          <span style={{ color: ACCENT_ORANGE }}>workshop</span>
          <span style={{ color: FG_FAINT }}>:~$ </span>
          <span style={{ color: FG }}>stats</span>
        </span>
        <span className="flex items-center gap-1 flex-none">
          <span className="size-2 rounded-full bg-[#ff5f56]" />
          <span className="size-2 rounded-full bg-[#ffbd2e]" />
          <span className="size-2 rounded-full bg-[#27c93f]" />
        </span>
      </header>
      <div className="px-3 py-2.5 text-[11.5px] font-mono space-y-0.5">
        <StatRow label={`since: ${stats.firstYear}`} />
        <StatRow label={`years: ${years}`} />
        <StatRow label={`shipped: ${stats.totalContributions.toLocaleString()}+`} check />
        <StatRow label="status: building" check />
      </div>
    </section>
  );
}

function StatRow({ label, check }: { label: string; check?: boolean }) {
  return (
    <div>
      <span style={{ color: ACCENT_CYAN }}>[</span>
      <span style={{ color: ACCENT_GREEN }}> {label} </span>
      <span style={{ color: ACCENT_CYAN }}>]</span>
      {check && (
        <span style={{ color: ACCENT_GREEN }} className="ml-2">
          ✓
        </span>
      )}
    </div>
  );
}

/* ─────────────────────────  Scanline overlay  ─────────────────── */

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

/* ─────────────────────────  Stats helpers  ────────────────────── */

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
    Math.round((totalContributions / Math.max(years, 1) / 365) * 1.6),
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

function parseYear(s: string | undefined): number | null {
  if (!s) return null;
  const m = s.match(/(19|20)\d{2}/);
  return m ? parseInt(m[0], 10) : null;
}

/* ─────────────────────────  Misc helpers  ─────────────────────── */

function pickQuote(
  r: ReturnType<typeof useResume>,
): { text: string; attribution: string; source?: string } | null {
  const winner = r.hackathons.find((h) => h.rank);
  if (winner && winner.description) {
    return {
      text: winner.description,
      attribution: winner.rank ?? winner.title,
      source: winner.title,
    };
  }
  for (const p of r.projects) {
    const mention = p.webMentions?.[0];
    if (mention?.snippet) {
      return {
        text: mention.snippet,
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
    ACCENT_AMBER,
    ACCENT_RED,
  ];
  return palette[i % palette.length];
}

function glyph(i: number): string {
  const glyphs = ["▸", "◆", "▣", "◉", "▤", "★", "◈", "▥", "⬢", "▰"];
  return glyphs[i % glyphs.length];
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

function sha7(id: string, salt: number): string {
  let h = (salt + 1) * 2654435761;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) - h + id.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(7, "0").slice(0, 7);
}
