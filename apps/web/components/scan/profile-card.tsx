"use client";

/**
 * Profile artifact — the hiring-manager-facing portfolio view.
 *
 * Data-driven port of the original JSX prototype. Takes a `ProfileCard`
 * (the slim shape emitted by emit-card.ts into 14-card.json) and renders:
 *
 *   - hero hook with handle + availability badge
 *   - 3 KPI tiles (auto-split from `label` → big/small number)
 *   - career-arc timeline chart
 *   - weekly activity area chart
 *   - team contributors bar chart
 *   - pattern story cards with receipts
 *   - shipped projects grid
 *   - disclosure card (when present)
 *
 * Typography mirrors the globals.css tokens: Plus Jakarta / Instrument
 * Serif / JetBrains Mono. Palette matches the JSX prototype — we keep
 * inline styles for the artifact because (a) this component is the
 * brand, and (b) porting every nuance to Tailwind would just add noise.
 */

import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip as RTooltip,
} from "recharts";
import type {
  ProfileCard,
  CardClaim,
  TimelineChartEntry,
  TeamHistogram,
  DailyActivity,
} from "@gitshow/shared/schemas";

// ─── Tokens (mirror the original JSX) ──────────────────────────────

const C = {
  1: "#3B82F6",
  2: "#8B5CF6",
  3: "#10B981",
  4: "#F59E0B",
  5: "#EF4444",
} as const;
const T = {
  bg: "#FAFAF7",
  card: "#FFF",
  border: "#E6E4DC",
  bl: "#F1F0EA",
  deep: "#D9D6CC",
  text: "#0F172A",
  sec: "#475569",
  mu: "#8C877C",
  gn: "#059669",
  gnBg: "#D1FAE5",
  amb: "#B45309",
};
const sans = `var(--font-sans), 'Plus Jakarta Sans', -apple-system, sans-serif`;
const mono = `var(--font-mono), 'JetBrains Mono', 'SF Mono', Consolas, monospace`;
const serif = `var(--font-serif), 'Instrument Serif', Georgia, serif`;

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * The original JSX used a fixed `{ big, small }` shape; our ProfileCard
 * packs the big number at the start of `label` ("3 competitive selections"
 * → "3" / "competitive selections"). Extract it so we can typeset the
 * hero number in the serif face.
 */
function splitBigSmall(label: string | undefined): {
  big: string;
  small: string;
} {
  if (!label) return { big: "·", small: "" };
  const match = label.match(/^([\d,.+~kmKM]+)\s*(.*)$/);
  if (match) return { big: match[1]!, small: match[2] ?? "" };
  return { big: label, small: "" };
}

function firstEvidenceUrl(claim: CardClaim): string | null {
  return claim.evidence_preview[0]?.url ?? null;
}

// ─── Timeline chart (custom SVG-less, inline-styled) ────────────────

function TimelineChart({ data }: { data: TimelineChartEntry[] }) {
  const [hover, setHover] = useState<{
    i: number;
    item: TimelineChartEntry;
    x: number;
    y: number;
  } | null>(null);

  const years = useMemo(() => {
    if (data.length === 0) return [2022, 2023, 2024, 2025, 2026];
    const yrs = Array.from(new Set(data.map((d) => d.year))).sort();
    const min = Math.min(...yrs, 2022);
    const max = Math.max(...yrs, new Date().getFullYear());
    const out: number[] = [];
    for (let y = min; y <= max; y++) out.push(y);
    return out;
  }, [data]);
  const minY = years[0]!;
  const maxY = years[years.length - 1]!;
  const range = Math.max(1, maxY - minY);

  const pos = (item: TimelineChartEntry) => {
    const frac = item.month ? (item.month - 1) / 12 : 0.5;
    return ((item.year + frac - minY) / range) * 100;
  };
  const rows = {
    win: { y: 12, label: "wins", color: C[4] },
    oss: { y: 37, label: "oss", color: C[2] },
    solo: { y: 62, label: "solo", color: C[3] },
    job: { y: 87, label: "job", color: C[1] },
  } as const;
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const dateLabel = (item: TimelineChartEntry) =>
    item.month ? `${months[item.month - 1]} ${item.year}` : `${item.year}`;

  return (
    <div style={{ position: "relative", height: 230, paddingLeft: 50 }}>
      {Object.entries(rows).map(([k, v]) => (
        <div key={k}>
          <div
            style={{
              position: "absolute",
              left: 0,
              top: `${v.y}%`,
              transform: "translateY(-50%)",
              fontSize: 9,
              fontFamily: mono,
              color: T.mu,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            {v.label}
          </div>
          <div
            style={{
              position: "absolute",
              left: 50,
              right: 0,
              top: `${v.y}%`,
              borderTop: `1px dashed ${T.deep}`,
            }}
          />
        </div>
      ))}

      <div
        style={{
          position: "absolute",
          left: 50,
          right: 0,
          bottom: -4,
          height: 22,
          borderTop: `1px solid ${T.deep}`,
        }}
      >
        {years.map((y) => (
          <div
            key={y}
            style={{
              position: "absolute",
              left: `${((y - minY) / range) * 100}%`,
              fontSize: 10,
              fontFamily: mono,
              color: T.mu,
              fontWeight: 600,
              transform: "translateX(-50%)",
              paddingTop: 5,
            }}
          >
            {y}
          </div>
        ))}
      </div>

      {data.map((item, i) => {
        const row = rows[item.type as keyof typeof rows];
        if (!row) return null;
        const size = item.major ? 12 : 9;
        const hit = 22;
        const isHovered = hover?.i === i;
        return (
          <div
            key={i}
            onMouseEnter={(e) => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              const parent = (
                e.currentTarget.parentElement as HTMLElement
              ).getBoundingClientRect();
              setHover({
                i,
                item,
                x: rect.left + rect.width / 2 - parent.left,
                y: rect.top - parent.top,
              });
            }}
            onMouseLeave={() => setHover(null)}
            style={{
              position: "absolute",
              left: `calc(50px + ${pos(item)}% * (100% - 50px) / 100%)`,
              top: `${row.y}%`,
              width: hit,
              height: hit,
              marginLeft: -hit / 2,
              marginTop: -hit / 2,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              zIndex: isHovered ? 5 : item.major ? 3 : 2,
            }}
          >
            <div
              style={{
                width: isHovered ? size + 4 : size,
                height: isHovered ? size + 4 : size,
                background: row.color,
                borderRadius: "50%",
                border: item.major
                  ? "2px solid #fff"
                  : isHovered
                    ? "2px solid #fff"
                    : "none",
                boxShadow: item.major
                  ? `0 0 0 2px ${row.color}`
                  : isHovered
                    ? `0 0 0 2px ${row.color}`
                    : "none",
                transition: "width 0.15s, height 0.15s, box-shadow 0.15s",
              }}
            />
          </div>
        );
      })}

      {data
        .filter((d) => d.major)
        .map((item, i) => {
          const p = pos(item);
          const row = rows[item.type as keyof typeof rows];
          if (!row) return null;
          const above = row.y < 50;
          const dim = !!hover && hover.item !== item;
          return (
            <div
              key={`lbl-${i}`}
              style={{
                position: "absolute",
                left: `calc(50px + ${p}% * (100% - 50px) / 100%)`,
                top: above ? `calc(${row.y}% + 14px)` : `calc(${row.y}% - 14px)`,
                transform: `translateX(${
                  p > 75 ? "-100%" : p < 15 ? "0%" : "-50%"
                }) translateY(${above ? "0" : "-100%"})`,
                fontSize: 10,
                fontFamily: mono,
                color: T.text,
                fontWeight: 700,
                background: T.card,
                padding: "2px 7px",
                borderRadius: 4,
                border: `1px solid ${T.deep}`,
                whiteSpace: "nowrap",
                zIndex: 4,
                opacity: dim ? 0.3 : 1,
                transition: "opacity 0.15s",
                pointerEvents: "none",
              }}
            >
              {item.label}
            </div>
          );
        })}

      {hover && (
        <div
          style={{
            position: "absolute",
            left: Math.max(120, Math.min(hover.x, 720)),
            top: Math.max(0, hover.y - 8),
            transform: "translate(-50%, -100%)",
            background: T.text,
            color: "#fff",
            padding: "10px 14px",
            borderRadius: 8,
            fontSize: 11,
            fontFamily: sans,
            lineHeight: 1.5,
            maxWidth: 300,
            minWidth: 200,
            boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
            pointerEvents: "none",
            zIndex: 10,
          }}
        >
          <div
            style={{
              fontSize: 9,
              fontFamily: mono,
              fontWeight: 700,
              color:
                rows[hover.item.type as keyof typeof rows]?.color ?? "#fff",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 3,
            }}
          >
            {dateLabel(hover.item)} ·{" "}
            {rows[hover.item.type as keyof typeof rows]?.label ?? hover.item.type}
          </div>
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              marginBottom: 5,
              letterSpacing: "-0.01em",
            }}
          >
            {hover.item.label}
          </div>
          {hover.item.note && (
            <div
              style={{
                fontSize: 11,
                color: "rgba(255,255,255,0.78)",
                lineHeight: 1.5,
              }}
            >
              {hover.item.note}
            </div>
          )}
          <div
            style={{
              position: "absolute",
              left: "50%",
              bottom: -5,
              transform: "translateX(-50%) rotate(45deg)",
              width: 10,
              height: 10,
              background: T.text,
            }}
          />
        </div>
      )}
    </div>
  );
}

// ─── Weekly activity area chart ─────────────────────────────────────

function ActivityChart({ data }: { data: DailyActivity | null }) {
  const series = useMemo(() => {
    if (!data) return [] as Array<{ date: string; v: number }>;
    // Roll daily → weekly sums for a readable saw-tooth line.
    const byDate = new Map(
      data.days.map((d) => [d.date, (d.ins ?? 0) + (d.del ?? 0)]),
    );
    if (byDate.size === 0) return [];
    const dates = Array.from(byDate.keys()).sort();
    const start = new Date(dates[0]!);
    const end = new Date(dates[dates.length - 1]!);
    const out: Array<{ date: string; v: number }> = [];
    for (
      const d = new Date(start);
      d <= end;
      d.setDate(d.getDate() + 7)
    ) {
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

  if (series.length === 0) {
    return (
      <div style={{ fontSize: 11, color: T.mu, fontFamily: mono }}>
        No daily activity series available for this scan.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={series} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="activity" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C[1]} stopOpacity={0.35} />
            <stop offset="100%" stopColor={C[1]} stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="date"
          tick={{ fontSize: 9, fill: T.mu, fontFamily: mono }}
          axisLine={{ stroke: T.deep }}
          tickLine={false}
          tickFormatter={(v: string) => {
            const [y, m] = v.split("-");
            return m === "01" ? y! : m === "07" ? `${y}·H2` : "";
          }}
          interval="preserveStartEnd"
        />
        <YAxis hide />
        <RTooltip
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0]!.payload as { date: string; v: number };
            return (
              <div
                style={{
                  background: "#fff",
                  border: `1px solid ${T.border}`,
                  borderRadius: 6,
                  padding: "6px 10px",
                  fontSize: 11,
                  fontFamily: mono,
                  boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                }}
              >
                <div style={{ color: T.mu, fontSize: 9, marginBottom: 2 }}>
                  week of {p.date}
                </div>
                <div style={{ fontWeight: 700 }}>
                  {p.v.toLocaleString()} lines
                </div>
              </div>
            );
          }}
        />
        <Area
          type="monotone"
          dataKey="v"
          stroke={C[1]}
          strokeWidth={1.5}
          fill="url(#activity)"
          animationDuration={1400}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ─── Team bars ──────────────────────────────────────────────────────

function TeamBars({ data }: { data: TeamHistogram }) {
  const max = Math.max(...data.contributors.map((d) => d.commits), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      {data.contributors.map((d, i) => {
        const pct = (d.commits / max) * 100;
        return (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontFamily: mono,
              fontSize: 11,
            }}
          >
            <div
              style={{
                width: 140,
                color: d.is_user ? T.text : T.mu,
                fontWeight: d.is_user ? 700 : 500,
                flexShrink: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {d.name}
            </div>
            <div
              style={{
                flex: 1,
                height: 13,
                background: T.bl,
                borderRadius: 3,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${pct}%`,
                  height: "100%",
                  background: d.is_user ? C[1] : T.deep,
                  animation: `grow 1.4s cubic-bezier(.16,1,.3,1) ${i * 0.04}s both`,
                }}
              />
            </div>
            <div
              style={{
                width: 62,
                textAlign: "right",
                color: d.is_user ? T.text : T.mu,
                fontWeight: d.is_user ? 700 : 500,
              }}
            >
              {d.commits.toLocaleString()}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Section + receipt primitives ──────────────────────────────────

function SectionLabel({
  children,
  counter,
}: {
  children: React.ReactNode;
  counter?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 10,
        marginBottom: 16,
        fontFamily: mono,
        fontSize: 10,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.14em",
        color: T.mu,
      }}
    >
      {counter && <span style={{ color: C[1] }}>{counter}</span>}
      <span>{children}</span>
      <span
        style={{
          flex: 1,
          height: 1,
          background: T.deep,
          marginLeft: 4,
        }}
      />
    </div>
  );
}

function Receipt({ label, url }: { label: string; url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        marginTop: 12,
        padding: "6px 10px",
        background: T.bl,
        borderRadius: 6,
        fontSize: 10,
        fontFamily: mono,
        color: T.sec,
        textDecoration: "none",
        border: `1px solid ${T.deep}`,
        transition: "background 0.15s",
        maxWidth: "100%",
        overflow: "hidden",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = T.deep;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = T.bl;
      }}
    >
      <span style={{ opacity: 0.7 }}>⌥</span>
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label.length > 60 ? label.slice(0, 60) + "…" : label}
      </span>
      <span style={{ opacity: 0.5, flexShrink: 0 }}>↗</span>
    </a>
  );
}

// ─── Main component ────────────────────────────────────────────────

export interface ProfileCardViewProps {
  card: ProfileCard;
  /**
   * When true, shows the "available" badge + contact button. Off for
   * previews inside a running-scan right pane.
   */
  chrome?: boolean;
  /**
   * Optional click target for a claim card (pattern / number / shipped /
   * disclosure / hook). Used by the split-pane to pin a revise target.
   */
  onClaimClick?: (claimId: string, beat: CardClaim["beat"]) => void;
  /** Highlight a claim as the active revise target. */
  highlightClaimId?: string | null;
}

export function ProfileCardView({
  card,
  chrome = true,
  onClaimClick,
  highlightClaimId,
}: ProfileCardViewProps) {
  const av = useMemo(
    () => card.handle.slice(0, 2).toUpperCase(),
    [card.handle],
  );
  const sub = card.primary_shape;

  return (
    <div
      style={{
        background: T.bg,
        color: T.text,
        fontFamily: sans,
      }}
    >
      {chrome && (
        <nav
          style={{
            position: "sticky",
            top: 0,
            zIndex: 40,
            background: "rgba(250,250,247,0.85)",
            backdropFilter: "blur(20px)",
            borderBottom: `1px solid ${T.border}`,
            padding: "0 28px",
            height: 52,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: 7,
                background: T.text,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: mono,
                fontWeight: 700,
                fontSize: 12,
                color: "#fff",
              }}
            >
              g
            </div>
            <span
              style={{
                fontWeight: 700,
                fontSize: 14,
                letterSpacing: "-0.02em",
              }}
            >
              gitshow
              <span style={{ color: T.mu }}>.io</span>
            </span>
          </div>
          <a
            href={`https://github.com/${card.handle}`}
            target="_blank"
            rel="noreferrer"
            style={{
              padding: "7px 16px",
              borderRadius: 7,
              border: "none",
              background: T.text,
              color: "#fff",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Contact →
          </a>
        </nav>
      )}

      <div
        style={{
          maxWidth: 880,
          margin: "0 auto",
          padding: "40px 28px 100px",
        }}
      >
        {/* HERO */}
        <HeroSection
          card={card}
          av={av}
          sub={sub}
          onClaimClick={onClaimClick}
          highlightClaimId={highlightClaimId}
        />

        {/* NUMBERS */}
        <NumbersSection
          card={card}
          onClaimClick={onClaimClick}
          highlightClaimId={highlightClaimId}
        />

        {/* CAREER ARC */}
        {card.charts.timeline.length > 0 && (
          <section style={{ marginBottom: 40 }}>
            <SectionLabel counter="01">career arc</SectionLabel>
            <div
              style={{
                padding: "20px 22px 14px",
                borderRadius: 12,
                background: T.card,
                border: `1px solid ${T.border}`,
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  color: T.sec,
                  marginBottom: 14,
                  fontFamily: mono,
                }}
              >
                Wins, OSS, solo, and job streams in parallel. Hover any dot.
              </div>
              <TimelineChart data={card.charts.timeline} />
              <div
                style={{
                  display: "flex",
                  gap: 16,
                  marginTop: 22,
                  fontSize: 10,
                  fontFamily: mono,
                  color: T.mu,
                  flexWrap: "wrap",
                }}
              >
                {(
                  [
                    ["Wins", C[4]],
                    ["OSS", C[2]],
                    ["Solo", C[3]],
                    ["Job", C[1]],
                  ] as const
                ).map(([name, color]) => (
                  <span
                    key={name}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: color,
                      }}
                    />{" "}
                    {name}
                  </span>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ACTIVITY */}
        {card.charts.primary_repo_daily_activity && (
          <section style={{ marginBottom: 40 }}>
            <SectionLabel counter="02">
              {card.charts.primary_repo_daily_activity.repo} output over time
            </SectionLabel>
            <div
              style={{
                padding: "22px 24px 12px",
                borderRadius: 12,
                background: T.card,
                border: `1px solid ${T.border}`,
              }}
            >
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: T.text,
                  marginBottom: 2,
                }}
              >
                Weekly lines changed on {card.charts.primary_repo_daily_activity.repo}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: T.mu,
                  fontFamily: mono,
                  marginBottom: 16,
                }}
              >
                Sum of additions + deletions per week · window still open
              </div>
              <ActivityChart data={card.charts.primary_repo_daily_activity} />
              <div
                style={{
                  fontSize: 10,
                  color: T.mu,
                  fontFamily: mono,
                  marginTop: 4,
                  fontStyle: "italic",
                }}
              >
                Peak weeks highlight bursts of iteration; troughs are triage.
              </div>
            </div>
          </section>
        )}

        {/* TEAM */}
        {card.charts.primary_repo_team &&
          card.charts.primary_repo_team.contributors.length > 0 && (
            <section style={{ marginBottom: 40 }}>
              <SectionLabel counter="03">who writes it</SectionLabel>
              <div
                style={{
                  padding: "22px 24px",
                  borderRadius: 12,
                  background: T.card,
                  border: `1px solid ${T.border}`,
                }}
              >
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: T.text,
                    marginBottom: 2,
                  }}
                >
                  Top contributors · {card.charts.primary_repo_team.repo}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: T.mu,
                    fontFamily: mono,
                    marginBottom: 16,
                  }}
                >
                  Commit count across the life of the repo
                </div>
                <TeamBars data={card.charts.primary_repo_team} />
              </div>
            </section>
          )}

        {/* PATTERNS */}
        {card.patterns.length > 0 && (
          <section style={{ marginBottom: 40 }}>
            <SectionLabel counter="04">patterns from the commit log</SectionLabel>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
                gap: 10,
              }}
            >
              {card.patterns.map((p) => (
                <PatternCard
                  key={p.id}
                  claim={p}
                  onClick={onClaimClick}
                  highlighted={p.id === highlightClaimId}
                />
              ))}
            </div>
          </section>
        )}

        {/* SHIPPED */}
        {card.shipped.length > 0 && (
          <section style={{ marginBottom: 40 }}>
            <SectionLabel counter="05">shipped</SectionLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {card.shipped.map((s) => (
                <ShippedRow
                  key={s.id}
                  claim={s}
                  onClick={onClaimClick}
                  highlighted={s.id === highlightClaimId}
                />
              ))}
            </div>
          </section>
        )}

        {/* DISCLOSURE */}
        {card.disclosure && (
          <section style={{ marginBottom: 36 }}>
            <SectionLabel counter="06">next chapter</SectionLabel>
            <div
              onClick={() =>
                onClaimClick?.(card.disclosure!.id, card.disclosure!.beat)
              }
              style={{
                padding: "22px 26px",
                borderRadius: 12,
                background: "#FDFBF5",
                border: `1px solid ${T.amb}33`,
                borderLeft: `3px solid ${T.amb}`,
                cursor: onClaimClick ? "pointer" : "default",
                outline:
                  highlightClaimId === card.disclosure.id
                    ? `2px solid ${C[1]}`
                    : "none",
                outlineOffset: 2,
              }}
            >
              {card.disclosure.label && (
                <h3
                  style={{
                    margin: "0 0 8px",
                    fontSize: 17,
                    fontFamily: serif,
                    fontWeight: 400,
                    color: T.text,
                    lineHeight: 1.3,
                    letterSpacing: "-0.01em",
                  }}
                >
                  {card.disclosure.label}
                </h3>
              )}
              <p
                style={{
                  margin: "0 0 10px",
                  fontSize: 13,
                  color: T.sec,
                  lineHeight: 1.6,
                }}
              >
                {card.disclosure.text}
              </p>
              {card.disclosure.sublabel && (
                <div
                  style={{
                    fontSize: 10,
                    color: T.amb,
                    fontFamily: mono,
                    fontWeight: 600,
                    letterSpacing: "0.04em",
                  }}
                >
                  {card.disclosure.sublabel}
                </div>
              )}
            </div>
          </section>
        )}

        <footer
          style={{
            paddingTop: 20,
            borderTop: `1px solid ${T.border}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontFamily: mono,
            fontSize: 10,
            color: T.mu,
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <span>Every claim links to a commit. Click the receipts.</span>
          <a
            href={`https://github.com/${card.handle}`}
            target="_blank"
            rel="noreferrer"
            style={{
              color: T.sec,
              textDecoration: "none",
              borderBottom: `1px solid ${T.deep}`,
            }}
          >
            github.com/{card.handle} ↗
          </a>
        </footer>
      </div>
    </div>
  );
}

// ─── Subcomponents ─────────────────────────────────────────────────

function HeroSection({
  card,
  av,
  sub,
  onClaimClick,
  highlightClaimId,
}: {
  card: ProfileCard;
  av: string;
  sub: string | undefined;
  onClaimClick?: ProfileCardViewProps["onClaimClick"];
  highlightClaimId?: string | null;
}) {
  const hook = card.hook;
  const highlight = hook && hook.id === highlightClaimId;

  return (
    <section style={{ marginBottom: 40 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 18,
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: `linear-gradient(135deg, ${C[1]}, ${C[2]})`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 15,
            fontWeight: 800,
            color: "#fff",
          }}
        >
          {av}
        </div>
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                fontSize: 17,
                fontWeight: 800,
                letterSpacing: "-0.02em",
              }}
            >
              @{card.handle}
            </span>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "2px 8px",
                borderRadius: 99,
                fontSize: 9,
                fontWeight: 700,
                background: T.gnBg,
                color: T.gn,
                fontFamily: mono,
                letterSpacing: "0.04em",
              }}
            >
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  background: T.gn,
                }}
              />
              AVAILABLE
            </span>
          </div>
          <div style={{ fontSize: 11, color: T.mu, marginTop: 2, fontFamily: mono }}>
            generated {card.generated_at.slice(0, 10)}
          </div>
        </div>
      </div>
      <h1
        onClick={() => hook && onClaimClick?.(hook.id, hook.beat)}
        style={{
          margin: "0 0 12px",
          fontFamily: serif,
          fontSize: 28,
          lineHeight: 1.3,
          letterSpacing: "-0.015em",
          fontWeight: 400,
          color: T.text,
          cursor: hook && onClaimClick ? "pointer" : "default",
          outline: highlight ? `2px solid ${C[1]}` : "none",
          outlineOffset: 4,
          borderRadius: highlight ? 4 : undefined,
        }}
      >
        {hook?.text ?? "Hook is still generating…"}
      </h1>
      {sub && (
        <p
          style={{
            margin: 0,
            fontSize: 12,
            color: T.mu,
            fontFamily: mono,
            letterSpacing: "0.02em",
          }}
        >
          {sub}
        </p>
      )}
    </section>
  );
}

function NumbersSection({
  card,
  onClaimClick,
  highlightClaimId,
}: {
  card: ProfileCard;
  onClaimClick?: ProfileCardViewProps["onClaimClick"];
  highlightClaimId?: string | null;
}) {
  if (card.numbers.length === 0) return null;
  return (
    <section style={{ marginBottom: 40 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 10,
        }}
      >
        {card.numbers.map((n) => {
          const { big, small } = splitBigSmall(n.label);
          const highlight = n.id === highlightClaimId;
          return (
            <div
              key={n.id}
              onClick={() => onClaimClick?.(n.id, n.beat)}
              style={{
                padding: "18px 18px",
                borderRadius: 12,
                background: T.card,
                border: `1px solid ${T.border}`,
                cursor: onClaimClick ? "pointer" : "default",
                outline: highlight ? `2px solid ${C[1]}` : "none",
                outlineOffset: 2,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 5,
                  marginBottom: 8,
                }}
              >
                <div
                  style={{
                    fontFamily: serif,
                    fontSize: 42,
                    lineHeight: 1,
                    letterSpacing: "-0.03em",
                    color: T.text,
                  }}
                >
                  {big}
                </div>
                <div
                  style={{ fontSize: 13, color: T.mu, fontFamily: mono }}
                >
                  {small}
                </div>
              </div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: T.text,
                  marginBottom: 4,
                }}
              >
                {n.sublabel ?? n.label ?? ""}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: T.sec,
                  lineHeight: 1.5,
                  fontFamily: mono,
                }}
              >
                {n.text}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function PatternCard({
  claim,
  onClick,
  highlighted,
}: {
  claim: CardClaim;
  onClick?: ProfileCardViewProps["onClaimClick"];
  highlighted: boolean;
}) {
  const url = firstEvidenceUrl(claim);
  return (
    <div
      onClick={() => onClick?.(claim.id, claim.beat)}
      style={{
        padding: "20px 22px",
        borderRadius: 12,
        background: T.card,
        border: `1px solid ${T.border}`,
        cursor: onClick ? "pointer" : "default",
        outline: highlighted ? `2px solid ${C[1]}` : "none",
        outlineOffset: 2,
      }}
    >
      {claim.label && (
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 6,
            marginBottom: 12,
          }}
        >
          <div
            style={{
              fontFamily: serif,
              fontSize: 36,
              lineHeight: 1,
              letterSpacing: "-0.02em",
              color: C[1],
            }}
          >
            {claim.label}
          </div>
          {claim.sublabel && (
            <div
              style={{
                fontSize: 11,
                color: T.mu,
                fontFamily: mono,
                marginLeft: "auto",
              }}
            >
              {claim.sublabel}
            </div>
          )}
        </div>
      )}
      <p
        style={{
          margin: 0,
          fontSize: 12,
          color: T.sec,
          lineHeight: 1.6,
        }}
      >
        {claim.text}
      </p>
      {url && claim.evidence_preview[0] && (
        <Receipt
          label={claim.evidence_preview[0].title || "View evidence"}
          url={url}
        />
      )}
    </div>
  );
}

function ShippedRow({
  claim,
  onClick,
  highlighted,
}: {
  claim: CardClaim;
  onClick?: ProfileCardViewProps["onClaimClick"];
  highlighted: boolean;
}) {
  return (
    <div
      onClick={() => onClick?.(claim.id, claim.beat)}
      style={{
        padding: "14px 18px",
        borderRadius: 10,
        background: T.card,
        border: `1px solid ${T.border}`,
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: 14,
        alignItems: "center",
        cursor: onClick ? "pointer" : "default",
        outline: highlighted ? `2px solid ${C[1]}` : "none",
        outlineOffset: 2,
      }}
    >
      <div>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 8,
            marginBottom: 2,
            flexWrap: "wrap",
          }}
        >
          <span
            style={{ fontSize: 13, fontWeight: 700, color: T.text }}
          >
            {claim.label ?? "Project"}
          </span>
          {claim.sublabel && (
            <span
              style={{ fontSize: 10, color: T.mu, fontFamily: mono }}
            >
              {claim.sublabel}
            </span>
          )}
        </div>
        <div
          style={{ fontSize: 11, color: T.sec, lineHeight: 1.5 }}
        >
          {claim.text}
        </div>
      </div>
      {claim.evidence_preview[0] && (
        <a
          href={claim.evidence_preview[0].url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          style={{
            fontSize: 10,
            fontFamily: mono,
            color: T.sec,
            textDecoration: "none",
            whiteSpace: "nowrap",
            borderBottom: `1px solid ${T.deep}`,
          }}
        >
          open ↗
        </a>
      )}
    </div>
  );
}
