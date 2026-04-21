"use client";

/**
 * LeanProfileCard — the M2 rendering of a ProfileCard.
 *
 * Rules it enforces on render:
 *   - 3 KPI tiles, no paragraphs. Each = big number + sublabel + at most
 *     a 5-word evidence snippet. Confidence surfaces as a ring color.
 *   - 3 insight cards maximum, rendered as `<InsightCard>`s with a mini
 *     sparkline when the claim has a chart hint, else just the punch
 *     sentence.
 *   - Shipped renders as a horizontal scroll strip (5-7 projects),
 *     never stacked full-width cards.
 *   - Disclosure is ≤ 2 sentences (hard-trimmed here; upstream
 *     copy-editor targets the same budget).
 *   - Aha-moment: the single highest-confidence insight bubbles to a
 *     hero callout above the insights grid.
 *   - Evidence drawer: every claim exposes a "See evidence" button
 *     that opens a side panel with the linked artifacts.
 *
 * Uses shadcn chart primitives for every recharts render so tokens stay
 * consistent. No inline color literals — everything goes through CSS
 * vars in globals.css.
 */

import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type {
  ProfileCard,
  CardClaim,
  DailyActivity,
} from "@gitshow/shared/schemas";
import { cn } from "@/lib/utils";
import {
  TimelineChart,
  ActivityChart,
  TeamBars,
} from "@/components/scan/profile-card";
import { ThemeToggle } from "@/components/profile/theme-toggle";

// ─── Public entry ──────────────────────────────────────────────────

export function LeanProfileCard({ card }: { card: ProfileCard }) {
  const [evidence, setEvidence] = useState<CardClaim | null>(null);

  const topInsights = useMemo(
    () => pickTopInsights(card.patterns, 3),
    [card.patterns],
  );

  const aha = useMemo(() => pickAhaMoment(topInsights), [topInsights]);

  return (
    <article className="relative mx-auto w-full max-w-3xl px-4 sm:px-6 py-10 sm:py-16">
      <Header card={card} />

      <Hook hook={card.hook} />

      <KpiRow numbers={card.numbers} onEvidence={setEvidence} />

      <Visuals card={card} />

      {aha ? <AhaMoment claim={aha} /> : null}

      <Insights
        insights={topInsights.filter((i) => i.id !== aha?.id).slice(0, 3)}
        onEvidence={setEvidence}
      />

      <ShippedStrip shipped={card.shipped} />

      <Disclosure disclosure={card.disclosure} />

      <EvidenceDrawer claim={evidence} onClose={() => setEvidence(null)} />

      <Footer card={card} />
    </article>
  );
}

// ─── Header + hook ─────────────────────────────────────────────────

function Header({ card }: { card: ProfileCard }) {
  return (
    <header className="mb-8 flex items-center justify-between gap-3">
      <div className="flex items-baseline gap-3 min-w-0">
        <span className="font-mono text-[12px] text-muted-foreground">
          @{card.handle}
        </span>
        {card.primary_shape ? (
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground/70 truncate">
            {card.primary_shape}
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <ShareButton handle={card.handle} />
      </div>
    </header>
  );
}

function Hook({ hook }: { hook: CardClaim | null }) {
  if (!hook) return null;
  return (
    <h1
      className="font-[var(--font-serif)] text-[28px] leading-[1.18] sm:text-[36px] sm:leading-[1.12] tracking-tight mb-10"
      style={{ fontFamily: "var(--font-serif)" }}
    >
      {hook.text}
    </h1>
  );
}

// ─── KPI row ────────────────────────────────────────────────────────

function KpiRow({
  numbers,
  onEvidence,
}: {
  numbers: CardClaim[];
  onEvidence: (c: CardClaim) => void;
}) {
  // Hard cap at 3 — the card should never render more, copy-editor targets
  // exactly 3 but we defend here too.
  const tiles = numbers.slice(0, 3);
  if (tiles.length === 0) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-10">
      {tiles.map((c) => (
        <KpiTile key={c.id} claim={c} onEvidence={onEvidence} />
      ))}
    </div>
  );
}

function KpiTile({
  claim,
  onEvidence,
}: {
  claim: CardClaim;
  onEvidence: (c: CardClaim) => void;
}) {
  const { big, small } = splitBigSmall(claim.label);
  const ringClass = confidenceRing(claim.confidence);

  return (
    <button
      type="button"
      onClick={() => onEvidence(claim)}
      className={cn(
        "group relative flex flex-col items-start gap-1 rounded-2xl border border-border/40 bg-card/60 p-4 sm:p-5 text-left transition-[box-shadow,background-color] duration-200 hover:bg-card hover:shadow-[var(--shadow-card)] focus-visible:outline-none focus-visible:shadow-[var(--shadow-composer-focus)]",
        ringClass,
      )}
      aria-label={`${big} — see evidence`}
    >
      <div
        className="font-[var(--font-serif)] text-[40px] sm:text-[48px] leading-none tracking-tight"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        {big}
      </div>
      <div className="text-[12px] sm:text-[13px] text-foreground/80 leading-snug">
        {small || claim.sublabel || ""}
      </div>
      <div className="text-[11px] text-muted-foreground leading-snug mt-1 line-clamp-2">
        {truncateWords(stripMd(claim.text), 8)}
      </div>
      <span className="absolute right-3 top-3 text-[10px] text-muted-foreground/70 opacity-0 group-hover:opacity-100 transition-opacity">
        See evidence →
      </span>
    </button>
  );
}

// ─── Aha moment ─────────────────────────────────────────────────────

function AhaMoment({ claim }: { claim: CardClaim }) {
  return (
    <div className="mb-8 rounded-2xl border border-[var(--primary)]/20 bg-[var(--primary)]/[0.04] p-5 sm:p-6">
      <div className="flex items-center gap-2 mb-2">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--primary)]" />
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
          The most interesting thing
        </span>
      </div>
      <p className="text-[15px] sm:text-[17px] leading-relaxed">
        {stripMd(claim.text)}
      </p>
    </div>
  );
}

// ─── Insights ───────────────────────────────────────────────────────

function Insights({
  insights,
  onEvidence,
}: {
  insights: CardClaim[];
  onEvidence: (c: CardClaim) => void;
}) {
  if (insights.length === 0) return null;
  return (
    <>
      <h2 className="text-[11px] uppercase tracking-wide text-muted-foreground mb-3">
        {insights.length === 1
          ? "One more thing to know"
          : `${numberWord(insights.length)} more things to know`}
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-10">
        {insights.map((c) => (
          <InsightCard key={c.id} claim={c} onEvidence={onEvidence} />
        ))}
      </div>
    </>
  );
}

function InsightCard({
  claim,
  onEvidence,
}: {
  claim: CardClaim;
  onEvidence: (c: CardClaim) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onEvidence(claim)}
      className="group flex flex-col items-start gap-3 rounded-2xl border border-border/40 bg-card/60 p-4 sm:p-5 text-left transition-[box-shadow,background-color] duration-200 hover:bg-card hover:shadow-[var(--shadow-card)] focus-visible:outline-none focus-visible:shadow-[var(--shadow-composer-focus)]"
    >
      {claim.label ? (
        <div className="font-[var(--font-serif)] text-[26px] sm:text-[28px] leading-none tracking-tight">
          {claim.label}
        </div>
      ) : null}
      <p className="text-[13px] sm:text-[14px] text-foreground/85 leading-relaxed line-clamp-3">
        {truncateWords(stripMd(claim.text), 22)}
      </p>
      <div className="mt-auto flex items-center justify-between w-full pt-1">
        <span className="text-[11px] text-muted-foreground">
          {claim.evidence_count} receipt{claim.evidence_count === 1 ? "" : "s"}
        </span>
        <span className="text-[11px] text-muted-foreground/70 opacity-0 group-hover:opacity-100 transition-opacity">
          See evidence →
        </span>
      </div>
    </button>
  );
}

// ─── Visuals (timeline · activity · team) ──────────────────────────
//
// Three compact chart tiles below the KPI row. Same data the big
// ProfileCardView renders — we bring it into the lean card because
// users flagged that the public /{handle} felt too thin compared to
// the preview. Clicking a tile doesn't open anything; they're a
// "read at a glance" surface. Each tile is collapsible on mobile to
// keep the card scannable.

function Visuals({ card }: { card: ProfileCard }) {
  const has = {
    timeline: card.charts.timeline.length > 0,
    activity: !!card.charts.primary_repo_daily_activity,
    team:
      !!card.charts.primary_repo_team &&
      card.charts.primary_repo_team.contributors.length > 0,
  };
  if (!has.timeline && !has.activity && !has.team) return null;
  return (
    <section className="mb-10 flex flex-col gap-4">
      {has.timeline ? (
        <VisualTile title="Timeline" subtitle="wins · OSS · solo · job">
          <TimelineChart data={card.charts.timeline} />
        </VisualTile>
      ) : null}
      {has.activity ? (
        <VisualTile
          title="Activity"
          subtitle={`${card.charts.primary_repo_daily_activity!.repo} · lines changed / week`}
        >
          <ActivityChart data={card.charts.primary_repo_daily_activity} />
        </VisualTile>
      ) : null}
      {has.team ? (
        <VisualTile
          title="Team"
          subtitle={`top contributors · ${card.charts.primary_repo_team!.repo}`}
        >
          <TeamBars data={card.charts.primary_repo_team!} />
        </VisualTile>
      ) : null}
    </section>
  );
}

function VisualTile({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border/40 bg-card/60 p-4 sm:p-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {title}
        </h2>
        <span className="font-mono text-[10px] text-muted-foreground/70 truncate">
          {subtitle}
        </span>
      </div>
      {children}
    </div>
  );
}

// ─── Shipped strip ──────────────────────────────────────────────────

function ShippedStrip({ shipped }: { shipped: CardClaim[] }) {
  if (shipped.length === 0) return null;
  return (
    <section className="mb-10 -mx-4 sm:-mx-6">
      <div className="flex items-baseline justify-between px-4 sm:px-6 mb-3">
        <h2 className="text-[11px] uppercase tracking-wide text-muted-foreground">
          What I&apos;ve shipped
        </h2>
        <span className="text-[11px] text-muted-foreground/70">
          {shipped.length} project{shipped.length === 1 ? "" : "s"}
        </span>
      </div>
      <div
        className="flex gap-3 sm:gap-4 overflow-x-auto px-4 sm:px-6 pb-2 gs-pane-scroll"
        style={{ scrollSnapType: "x proximity" }}
      >
        {shipped.map((c) => (
          <ShippedCard key={c.id} claim={c} />
        ))}
      </div>
    </section>
  );
}

function ShippedCard({ claim }: { claim: CardClaim }) {
  const url = claim.evidence_preview[0]?.url;
  // Evidence count + first-preview title let the user see at a glance
  // how well-backed the project line is. Wider card + lighter text
  // clamp so the description has room to breathe — the earlier
  // 3-line truncation was stripping useful detail.
  const evidenceCount = claim.evidence_count ?? claim.evidence_preview.length;
  const inner = (
    <div
      className="group flex w-[320px] shrink-0 flex-col gap-3 rounded-2xl border border-border/50 bg-card/70 p-5 transition-[box-shadow,background-color,transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-border hover:bg-card hover:shadow-[var(--shadow-card)]"
      style={{ scrollSnapAlign: "start" }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="h-2 w-2 rounded-full bg-[var(--chart-3)] shrink-0" />
          <span className="text-[14px] font-semibold text-foreground truncate">
            {claim.label ?? "Project"}
          </span>
        </div>
        {url ? (
          <span className="font-mono text-[10px] text-muted-foreground transition-colors group-hover:text-foreground shrink-0">
            open ↗
          </span>
        ) : null}
      </div>
      {claim.sublabel ? (
        <div className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground truncate">
          {claim.sublabel}
        </div>
      ) : null}
      <div className="text-[13px] leading-relaxed text-foreground/85">
        {stripMd(claim.text)}
      </div>
      {evidenceCount > 0 ? (
        <div className="mt-auto flex items-center gap-1.5 border-t border-border/30 pt-3 font-mono text-[10px] text-muted-foreground">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--chart-1)]" />
          {evidenceCount} {evidenceCount === 1 ? "commit" : "commits"} linked
        </div>
      ) : null}
    </div>
  );
  return url ? (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="focus-visible:outline-none focus-visible:shadow-[var(--shadow-composer-focus)] rounded-2xl"
    >
      {inner}
    </a>
  ) : (
    inner
  );
}

// ─── Disclosure ─────────────────────────────────────────────────────

function Disclosure({ disclosure }: { disclosure: CardClaim | null }) {
  if (!disclosure) return null;
  // Hard-trim to 2 sentences regardless of what copy-editor sends.
  const text = trimSentences(stripMd(disclosure.text), 2);
  return (
    <div className="mb-10 rounded-2xl border border-[var(--chart-4)]/25 bg-[var(--chart-4)]/[0.05] p-5 sm:p-6">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
        Working on
      </div>
      <p className="text-[14px] leading-relaxed">{text}</p>
    </div>
  );
}

// ─── Evidence drawer ───────────────────────────────────────────────

function EvidenceDrawer({
  claim,
  onClose,
}: {
  claim: CardClaim | null;
  onClose: () => void;
}) {
  if (!claim) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Evidence"
      className="fixed inset-0 z-50 flex items-stretch justify-end"
    >
      <button
        type="button"
        aria-label="Close evidence"
        onClick={onClose}
        className="absolute inset-0 bg-background/60 backdrop-blur-[2px] gs-fade"
      />
      <aside className="relative z-10 w-full sm:max-w-md h-full bg-card border-l border-border/40 shadow-[var(--shadow-float)] gs-enter overflow-y-auto gs-pane-scroll">
        <header className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b border-border/30 bg-card/95 backdrop-blur">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Why we said this
            </div>
            <h3 className="text-[14px] font-medium">{claim.label ?? "Claim"}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[13px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Close
          </button>
        </header>
        <div className="px-5 py-4">
          <p className="text-[13px] leading-relaxed mb-4">
            {stripMd(claim.text)}
          </p>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
            Evidence ({claim.evidence_count})
          </div>
          <ul className="space-y-3">
            {claim.evidence_preview.map((e) => (
              <li key={e.id}>
                <a
                  href={e.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-lg border border-border/30 bg-background/60 p-3 transition-colors hover:bg-muted/40"
                >
                  <div className="font-mono text-[10px] uppercase text-muted-foreground">
                    {e.type}
                  </div>
                  <div className="text-[13px] leading-snug mt-1 truncate">
                    {e.title}
                  </div>
                </a>
              </li>
            ))}
          </ul>
          {claim.evidence_count > claim.evidence_preview.length ? (
            <p className="mt-3 text-[11px] text-muted-foreground">
              {claim.evidence_count - claim.evidence_preview.length} more not shown.
            </p>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

// ─── Footer / share ────────────────────────────────────────────────

function Footer({ card }: { card: ProfileCard }) {
  return (
    <footer className="mt-12 pt-6 border-t border-border/30 flex items-center justify-between text-[11px] text-muted-foreground">
      <span>
        generated {new Date(card.generated_at).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}
      </span>
      <span className="font-mono">gitshow.io</span>
    </footer>
  );
}

function ShareButton({ handle }: { handle: string }) {
  const [copied, setCopied] = useState(false);
  const onClick = async () => {
    const url = `${window.location.origin}/${encodeURIComponent(handle)}`;
    try {
      if (navigator.share) {
        await navigator.share({ url, title: `@${handle} on gitshow` });
      } else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    } catch {
      /* user cancelled */
    }
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[12px] text-muted-foreground hover:text-foreground transition-colors min-h-9 px-2"
      aria-label="Share this profile"
    >
      {copied ? "Copied" : "Share ↗"}
    </button>
  );
}

// ─── Tiny charts available for future insight cards ────────────────

export function MiniSparkline({
  points,
  color = "var(--chart-1)",
}: {
  points: Array<{ x: string; y: number }>;
  color?: string;
}) {
  const config: ChartConfig = { y: { label: "", color } };
  return (
    <ChartContainer config={config} className="h-12 w-full aspect-auto">
      <AreaChart data={points} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="mini-spark" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.25} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="x" hide />
        <YAxis hide />
        <Area
          type="monotone"
          dataKey="y"
          stroke={color}
          strokeWidth={1.5}
          fill="url(#mini-spark)"
          isAnimationActive
        />
      </AreaChart>
    </ChartContainer>
  );
}

// Re-export the existing charts for the evidence drawer (optional)
export function ActivityAreaChart({ data }: { data: DailyActivity | null }) {
  const series = useMemo(() => {
    if (!data) return [] as Array<{ date: string; v: number }>;
    const byDate = new Map(
      data.days.map((d) => [d.date, (d.ins ?? 0) + (d.del ?? 0)]),
    );
    if (byDate.size === 0) return [];
    const dates = Array.from(byDate.keys()).sort();
    const start = new Date(dates[0]!);
    const end = new Date(dates[dates.length - 1]!);
    const out: Array<{ date: string; v: number }> = [];
    for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 7)) {
      let sum = 0;
      for (let i = 0; i < 7; i++) {
        const dd = new Date(d);
        dd.setDate(dd.getDate() + i);
        const key = dd.toISOString().slice(0, 10);
        if (byDate.has(key)) sum += byDate.get(key)!;
      }
      out.push({ date: new Date(d).toISOString().slice(0, 10), v: sum });
    }
    return out;
  }, [data]);

  const config: ChartConfig = {
    v: { label: "lines", color: "var(--chart-1)" },
  };

  if (series.length === 0) {
    return (
      <div className="text-[12px] text-muted-foreground">
        No activity series available.
      </div>
    );
  }

  return (
    <ChartContainer config={config} className="h-[180px]">
      <AreaChart data={series} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="activity-chart" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-v)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--color-v)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: string) => v.slice(0, 7)}
          tick={{ fontSize: 10 }}
          interval="preserveStartEnd"
        />
        <YAxis hide />
        <ChartTooltip cursor content={<ChartTooltipContent hideLabel />} />
        <Area
          type="monotone"
          dataKey="v"
          stroke="var(--color-v)"
          strokeWidth={1.5}
          fill="url(#activity-chart)"
          isAnimationActive
        />
      </AreaChart>
    </ChartContainer>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────

function splitBigSmall(label: string | undefined): {
  big: string;
  small: string;
} {
  if (!label) return { big: "·", small: "" };
  const match = label.match(/^([\d,.+~kmKM]+)\s*(.*)$/);
  if (match) return { big: match[1]!, small: match[2] ?? "" };
  return { big: label, small: "" };
}

function stripMd(s: string): string {
  // Extremely light: drop markdown links/bold markers; leave text intact.
  return s
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}

function truncateWords(s: string, max: number): string {
  const words = s.split(/\s+/);
  if (words.length <= max) return s;
  return words.slice(0, max).join(" ") + "…";
}

function trimSentences(s: string, max: number): string {
  // Conservative trimmer — split on period/question/exclamation followed
  // by whitespace. Collapses duplicate whitespace.
  const parts = s
    .split(/([.!?]\s+)/)
    .reduce<string[]>((acc, piece, i, arr) => {
      if (i % 2 === 0 && piece.trim()) {
        acc.push(piece + (arr[i + 1] ?? ""));
      }
      return acc;
    }, []);
  if (parts.length <= max) return s.trim();
  return parts.slice(0, max).join("").trim();
}

function confidenceRing(
  confidence: CardClaim["confidence"],
): string {
  switch (confidence) {
    case "high":
      return "ring-0";
    case "medium":
      return "ring-0";
    case "low":
      return "ring-1 ring-[var(--chart-4)]/30";
  }
}

function pickTopInsights(patterns: CardClaim[], max: number): CardClaim[] {
  // Prefer `primary = true` claims (the emit-card layer already marks
  // which claims belong in the hero patterns panel). Then rank by
  // evidence_count × confidence.
  const scored = patterns.map((c) => {
    const confScore =
      c.confidence === "high" ? 3 : c.confidence === "medium" ? 2 : 1;
    return { c, score: c.evidence_count * confScore * (c.primary ? 1 : 0.5) };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, max).map((x) => x.c);
}

function pickAhaMoment(insights: CardClaim[]): CardClaim | null {
  // Highest-scoring insight that also has a short-enough label to
  // feel headline-y. If nothing qualifies, skip the callout.
  if (insights.length === 0) return null;
  const best = insights[0];
  if (!best) return null;
  const words = stripMd(best.text).split(/\s+/).length;
  if (words > 30) return null;
  return best;
}

function numberWord(n: number): string {
  if (n === 2) return "Two";
  if (n === 3) return "Three";
  if (n === 4) return "Four";
  if (n === 5) return "Five";
  return String(n);
}

// Silence unused-import warnings for charts we expose but may not use here.
void Bar;
void BarChart;
void Line;
void LineChart;
