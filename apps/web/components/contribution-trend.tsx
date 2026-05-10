"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

/**
 * ContributionTrend — live GitHub contribution-trend chart.
 *
 * Pulls daily contribution counts via /api/contributions/{handle}, buckets
 * them into ISO weeks, and renders an SVG area chart with a trailing
 * pulse-dot. Token-driven so each template can wear its own palette
 * (Classic, Minimal, Terminal, …) without re-implementing the chart.
 *
 * Graph aggregation:
 *   • Weekly buckets (sum) — smooths out weekend dips so the trend reads.
 *   • Default window: every week the account has on file (lifetime).
 *     Pass `weeks` to clip to a trailing window (e.g. weeks=156 → 3y).
 *   • Y axis: sqrt(count) so heavy-tailed data (a single hackathon week
 *     can be 6× the typical week) doesn't squash the rest of the chart.
 *
 * Hover:
 *   • Pointer over the chart snaps to the nearest week and surfaces a
 *     subtle tooltip with the date + count, plus a vertical guide and
 *     a static dot. Touch devices follow the same pointer events.
 */

interface ApiResponse {
  total?: Record<string, number>;
  contributions?: Array<{ date: string; count: number; level: number }>;
}

export interface ContributionTrendProps {
  handle: string;

  /** Trailing window in ISO weeks. Omit to render the full lifetime. */
  weeks?: number;

  /** Headline color & line/dot/fill stroke. */
  accent: string;

  /** Primary readable text (the big total number). */
  fg: string;
  /** Secondary text (eyebrow label, caption). */
  dim: string;
  /** Tertiary / hairline grid color. */
  ghost: string;

  /** Background of the chart card. */
  cardBg?: string;
  /** Card border color. */
  cardBorder?: string;
  /** Border radius (px). */
  radius?: number;

  /** Pulse the trailing dot. Default true. */
  pulse?: boolean;

  /** Caption shown bottom-right (e.g. "GitHub contribution trend"). */
  caption?: string;

  /** Eyebrow label above the total. Default "CONTRIBUTIONS". */
  eyebrow?: string;

  /** Override the inner padding around the SVG area. */
  pad?: { x: number; y: number };

  /** Chart height in px (the surrounding shell scales to width). */
  chartHeight?: number;

  /** Override the total displayed (defaults to summed window). */
  totalOverride?: number;

  /** Optional className for the outermost wrapper. */
  className?: string;

  /**
   * Visual density. `comfy` (default) is the card-style layout with
   * generous padding around the headline. `compact` strips the inner
   * padding and shrinks the total digits — the right choice for the
   * Minimal template where the chart sits inside an existing section.
   */
  density?: "comfy" | "compact";

  /**
   * Tooltip surface — defaults work for most templates but Terminal
   * & Minimal benefit from explicit overrides so the tooltip doesn't
   * float against a same-color background.
   */
  tooltipBg?: string;
  tooltipBorder?: string;
}

interface NormalizedPoint {
  weekStart: string;
  count: number;
}

export default function ContributionTrend(props: ContributionTrendProps) {
  const {
    handle,
    weeks,
    accent,
    fg,
    dim,
    ghost,
    cardBg = "transparent",
    cardBorder,
    radius = 12,
    pulse = true,
    caption,
    eyebrow = "CONTRIBUTIONS",
    pad = { x: 12, y: 18 },
    chartHeight = 200,
    totalOverride,
    className,
    density = "comfy",
    tooltipBg,
    tooltipBorder,
  } = props;
  const compact = density === "compact";

  const data = useContributionData(handle);
  const series = useMemo(() => bucketWeekly(data, weeks), [data, weeks]);

  if (data === "error") return null;
  if (!series)
    return (
      <Skeleton
        ghost={ghost}
        chartHeight={chartHeight}
        cardBg={cardBg}
        cardBorder={cardBorder}
        radius={radius}
        className={className}
        compact={compact}
      />
    );

  const total = totalOverride ?? series.reduce((acc, p) => acc + p.count, 0);
  const totalLabel = formatTotal(total);

  return (
    <div
      className={className}
      style={{
        background: cardBg,
        border: cardBorder ? `1px solid ${cardBorder}` : undefined,
        borderRadius: radius,
        overflow: "hidden",
      }}
    >
      <div
        className={
          compact
            ? "px-1 pt-1 pb-0 flex items-baseline gap-2 flex-wrap"
            : "px-4 pt-3 pb-0 flex items-baseline gap-3 flex-wrap"
        }
      >
        <div className="flex items-baseline gap-2">
          <span
            className={
              compact
                ? "text-xl font-semibold tabular-nums leading-none"
                : "text-2xl font-semibold tabular-nums leading-none"
            }
            style={{ color: fg }}
          >
            {totalLabel}
          </span>
          <span
            className="text-[10px] uppercase tracking-[0.16em]"
            style={{ color: dim }}
          >
            {eyebrow}
          </span>
        </div>
      </div>

      <Chart
        series={series}
        accent={accent}
        ghost={ghost}
        chartHeight={chartHeight}
        pad={pad}
        pulse={pulse}
        fg={fg}
        dim={dim}
        tooltipBg={tooltipBg ?? cardBg}
        tooltipBorder={tooltipBorder ?? cardBorder ?? ghost}
        compact={compact}
      />

      {caption && (
        <div
          className={
            compact ? "px-1 pb-0 pt-1 text-[10.5px]" : "px-4 pb-2 pt-0 text-[10.5px]"
          }
          style={{ color: dim, textAlign: "right" }}
        >
          {caption}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────  Chart core  ────────────────────────── */

function Chart({
  series,
  accent,
  ghost,
  chartHeight,
  pad,
  pulse,
  fg,
  dim,
  tooltipBg,
  tooltipBorder,
  compact,
}: {
  series: NormalizedPoint[];
  accent: string;
  ghost: string;
  chartHeight: number;
  pad: { x: number; y: number };
  pulse: boolean;
  fg: string;
  dim: string;
  tooltipBg: string;
  tooltipBorder: string;
  compact: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(0);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const gradId = useId().replace(/[:]/g, "-");

  useEffect(() => {
    if (!wrapRef.current) return;
    const el = wrapRef.current;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const W = Math.max(w, 1);
  const H = chartHeight;
  const innerW = Math.max(W - pad.x * 2, 1);
  const innerH = Math.max(H - pad.y * 2, 1);

  const counts = series.map((p) => p.count);
  const maxV = Math.max(...counts, 1);
  // Sqrt y-scale: real contribution data is heavy-tailed (a single
  // hackathon week can be 6× the typical week). Linear scale would
  // squash 90% of the chart against the baseline. Square-root keeps
  // the ranking but lets the steady cadence read alongside the peaks.
  const yScale = (v: number): number => Math.sqrt(Math.max(v, 0));
  const yMaxScaled = yScale(maxV) * 1.12;

  const xAt = (i: number): number => {
    if (series.length <= 1) return pad.x + innerW / 2;
    return pad.x + (i / (series.length - 1)) * innerW;
  };
  const yAt = (v: number): number =>
    pad.y + innerH - (yScale(v) / yMaxScaled) * innerH;

  const linePath = useMemo(
    () =>
      buildSmoothPath(
        series.map((p, i) => [xAt(i), yAt(p.count)] as [number, number]),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series, w, chartHeight, pad.x, pad.y],
  );
  const areaPath = useMemo(() => {
    if (!series.length) return "";
    const baseY = pad.y + innerH;
    return `${linePath} L ${xAt(series.length - 1)},${baseY} L ${xAt(0)},${baseY} Z`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linePath, series.length, w, chartHeight, pad.y, innerH]);

  const lastIdx = series.length - 1;
  const lastX = xAt(lastIdx);
  const lastY = yAt(series[lastIdx]?.count ?? 0);

  const gridYs = [0.25, 0.5, 0.75].map((f) => pad.y + innerH * f);

  function pointerToIdx(clientX: number): number | null {
    if (!wrapRef.current) return null;
    const rect = wrapRef.current.getBoundingClientRect();
    const xPx = clientX - rect.left;
    // viewBox W matches wrap.clientWidth (no padding on the wrap), so
    // viewBox-x and screen-x are 1:1.
    if (series.length <= 1) return 0;
    const i = Math.round(((xPx - pad.x) / innerW) * (series.length - 1));
    return Math.max(0, Math.min(series.length - 1, i));
  }

  function handleMove(e: React.PointerEvent<HTMLDivElement>) {
    const i = pointerToIdx(e.clientX);
    if (i !== null) setHoverIdx(i);
  }
  function handleLeave() {
    setHoverIdx(null);
  }

  // Hovered point (if any) — used for guide, marker, tooltip.
  const hover = hoverIdx !== null ? series[hoverIdx] : null;
  const hoverX = hover ? xAt(hoverIdx!) : 0;
  const hoverY = hover ? yAt(hover.count) : 0;

  // Tooltip horizontal positioning — clamp so the bubble never goes
  // past the chart edge. Approximate width 160px / 2 = 80 half.
  const TT_HALF = 80;
  const tipLeft = hover
    ? Math.max(TT_HALF, Math.min(W - TT_HALF, hoverX))
    : 0;

  return (
    <div
      ref={wrapRef}
      style={{ width: "100%", position: "relative", touchAction: "pan-y" }}
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
      onPointerCancel={handleLeave}
    >
      <svg
        width="100%"
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="GitHub contribution trend"
      >
        <defs>
          <linearGradient id={`fill-${gradId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity={0.32} />
            <stop offset="100%" stopColor={accent} stopOpacity={0} />
          </linearGradient>
        </defs>

        {gridYs.map((y, i) => (
          <line
            key={i}
            x1={pad.x}
            x2={W - pad.x}
            y1={y}
            y2={y}
            stroke={ghost}
            strokeWidth={1}
            opacity={0.55}
          />
        ))}

        {areaPath && (
          <path d={areaPath} fill={`url(#fill-${gradId})`} stroke="none" />
        )}
        {linePath && (
          <path
            d={linePath}
            fill="none"
            stroke={accent}
            strokeWidth={1.6}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}

        {/* Trailing dot, optionally pulsing — hidden while hovering so
            the hover marker takes the spotlight. */}
        {!hover && Number.isFinite(lastX) && Number.isFinite(lastY) && (
          <g>
            {pulse && (
              <circle cx={lastX} cy={lastY} r={4.5} fill={accent} opacity={0.22}>
                <animate
                  attributeName="r"
                  values="4.5;9;4.5"
                  dur="2.4s"
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="opacity"
                  values="0.22;0;0.22"
                  dur="2.4s"
                  repeatCount="indefinite"
                />
              </circle>
            )}
            <circle cx={lastX} cy={lastY} r={3.5} fill={accent} />
            <circle cx={lastX} cy={lastY} r={1.6} fill="#000" opacity={0.18} />
          </g>
        )}

        {/* Hover guide + marker (rendered inside the SVG so the
            vertical line gets the same crisp 1px stroke as the grid). */}
        {hover && (
          <g pointerEvents="none">
            <line
              x1={hoverX}
              x2={hoverX}
              y1={pad.y}
              y2={pad.y + innerH}
              stroke={accent}
              strokeOpacity={0.5}
              strokeDasharray="2 3"
              strokeWidth={1}
            />
            <circle cx={hoverX} cy={hoverY} r={4.5} fill={accent} opacity={0.18} />
            <circle cx={hoverX} cy={hoverY} r={3} fill={accent} />
          </g>
        )}
      </svg>

      {/* Tooltip — positioned above the hover marker, clamped within
          the chart width so it never clips past the card edge. Two
          lines: count on top, date below, generous spacing between. */}
      {hover && (
        <div
          aria-hidden
          className="tabular-nums whitespace-nowrap"
          style={{
            position: "absolute",
            left: tipLeft,
            top: Math.max(hoverY - 14, 4),
            transform: "translate(-50%, -100%)",
            pointerEvents: "none",
            background: tooltipBg,
            border: `1px solid ${tooltipBorder}`,
            color: fg,
            padding: "8px 12px",
            borderRadius: 8,
            boxShadow:
              "0 1px 2px rgba(0,0,0,0.18), 0 10px 28px -12px rgba(0,0,0,0.55)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            transition: "left 90ms ease, top 90ms ease",
          }}
        >
          <div
            style={{
              color: fg,
              fontWeight: 600,
              fontSize: 13,
              lineHeight: 1.2,
              letterSpacing: "-0.01em",
            }}
          >
            {hover.count.toLocaleString()}{" "}
            <span style={{ color: dim, fontWeight: 400 }}>
              {hover.count === 1 ? "contribution" : "contributions"}
            </span>
          </div>
          <div
            style={{
              color: dim,
              fontSize: 11,
              lineHeight: 1.2,
              marginTop: 4,
            }}
          >
            {formatWeekLabel(hover.weekStart)}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────  Skeleton (loading)  ────────────────────────── */

function Skeleton({
  ghost,
  chartHeight,
  cardBg,
  cardBorder,
  radius,
  className,
  compact,
}: {
  ghost: string;
  chartHeight: number;
  cardBg: string;
  cardBorder?: string;
  radius: number;
  className?: string;
  compact: boolean;
}) {
  return (
    <div
      className={className}
      style={{
        background: cardBg,
        border: cardBorder ? `1px solid ${cardBorder}` : undefined,
        borderRadius: radius,
        overflow: "hidden",
      }}
    >
      <div className={compact ? "px-1 pt-1 pb-0" : "px-5 pt-4 pb-1"}>
        <div
          className="h-3 w-24 rounded"
          style={{ background: ghost, opacity: 0.6 }}
        />
        <div
          className="mt-2 h-7 w-20 rounded"
          style={{ background: ghost, opacity: 0.45 }}
        />
      </div>
      <div>
        <div
          className="my-2"
          style={{
            height: chartHeight - 12,
            background: `linear-gradient(180deg, ${ghost}30 0%, transparent 100%)`,
            opacity: 0.5,
            borderRadius: 6,
          }}
        />
      </div>
    </div>
  );
}

/* ─────────────────────────  Data hook  ────────────────────────── */

type FetchState =
  | null
  | "error"
  | {
      total: Record<string, number>;
      contributions: Array<{ date: string; count: number; level: number }>;
    };

function useContributionData(handle: string): FetchState {
  const [state, setState] = useState<FetchState>(null);
  useEffect(() => {
    if (!handle) return;
    let cancelled = false;
    fetch(`/api/contributions/${encodeURIComponent(handle)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`status ${r.status}`);
        const j = (await r.json()) as ApiResponse;
        if (cancelled) return;
        if (!Array.isArray(j.contributions)) {
          setState("error");
          return;
        }
        setState({
          total: j.total ?? {},
          contributions: j.contributions,
        });
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [handle]);
  return state;
}

/* ─────────────────────────  Aggregation  ────────────────────────── */

/**
 * Group daily contributions into ISO weeks (Mon-anchored). When `weeks`
 * is undefined the full lifetime is returned; otherwise only the last
 * `weeks` buckets. Returns null while data is loading.
 */
function bucketWeekly(
  data: FetchState,
  weeks: number | undefined,
): NormalizedPoint[] | null {
  if (!data || data === "error") return null;
  const days = data.contributions;
  if (!days.length) return [];

  // Drop future-dated days. The upstream API returns the full current
  // year (incl. days after today, all zero) which would otherwise pad
  // the chart with a long flat tail and squash the trend.
  const todayKey = new Date().toISOString().slice(0, 10);

  const buckets = new Map<string, number>();
  for (const d of days) {
    if (d.date > todayKey) continue;
    const ws = weekKey(d.date);
    if (!ws) continue;
    buckets.set(ws, (buckets.get(ws) ?? 0) + (d.count || 0));
  }

  const sortedKeys = [...buckets.keys()].sort();
  const trimmed =
    typeof weeks === "number" && weeks > 0
      ? sortedKeys.slice(Math.max(0, sortedKeys.length - weeks))
      : sortedKeys;

  return trimmed.map((k) => ({ weekStart: k, count: buckets.get(k) ?? 0 }));
}

/** ISO-style Monday anchor (YYYY-MM-DD). */
function weekKey(isoDate: string): string | null {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (dow - 1));
  return d.toISOString().slice(0, 10);
}

/* ─────────────────────────  Path helpers  ────────────────────────── */

function buildSmoothPath(pts: Array<[number, number]>): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) {
    const [x, y] = pts[0]!;
    return `M ${x},${y}`;
  }
  const segs: string[] = [];
  segs.push(`M ${pts[0]![0]},${pts[0]![1]}`);
  const tension = 0.18;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) * tension;
    const c1y = p1[1] + (p2[1] - p0[1]) * tension;
    const c2x = p2[0] - (p3[0] - p1[0]) * tension;
    const c2y = p2[1] - (p3[1] - p1[1]) * tension;
    segs.push(`C ${c1x},${c1y} ${c2x},${c2y} ${p2[0]},${p2[1]}`);
  }
  return segs.join(" ");
}

/* ─────────────────────────  Misc  ────────────────────────── */

function formatTotal(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
}

const MONTHS_SHORT = [
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

function formatWeekLabel(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  const month = MONTHS_SHORT[d.getUTCMonth()];
  const day = d.getUTCDate();
  const year = d.getUTCFullYear();
  return `${month} ${day}, ${year}`;
}
