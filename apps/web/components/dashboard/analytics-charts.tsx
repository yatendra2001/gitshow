"use client";

/* eslint-disable @next/next/no-img-element */

/**
 * Recharts-backed visuals for the analytics dashboard.
 *
 * Visual rules:
 *   - Time-series charts (area, sparkline, hourly bars) use a single accent
 *     hue (`--gradient-primary`) — premium, calm, reads like a ribbon.
 *   - Categorical breakdowns (pie/donut/horizontal bar) use the
 *     shadcn `--chart-1..5` palette — distinct hues, calibrated chroma so
 *     no slice screams. Multi-hue is the only way 85/9/6 splits are
 *     readable.
 *   - Hairline gridlines (currentColor at 0.05) keep gridlines from
 *     shouting over data.
 *   - Hour-of-day chart shifts UTC buckets to the viewer's local timezone
 *     on the client, so "9pm" means *their* 9pm.
 */

import * as React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Label,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { faviconUrl, formatCount, formatDateShort, prettyReferrer, SENTINEL_HOSTS } from "./format";

// ─── Sparkline (KPI card footer) ──────────────────────────────────

export function SparklineMini({
  data,
  color = "var(--gradient-primary)",
}: {
  data: { x: number; value: number }[];
  color?: string;
}) {
  if (!data.length) return null;
  const gradientId = `gs-spark-${color.replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <div className="h-9 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeOpacity={0.85}
            strokeWidth={1.5}
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Big views chart ──────────────────────────────────────────────

const VIEWS_CHART_CONFIG: ChartConfig = {
  views: { label: "Views", color: "var(--gradient-primary)" },
  uniques: { label: "Uniques", color: "var(--gradient-primary)" },
};

export function ViewsAreaChart({
  data,
  height = 280,
}: {
  data: { date: string; views: number; uniques: number }[];
  height?: number;
}) {
  return (
    <ChartContainer
      config={VIEWS_CHART_CONFIG}
      className="aspect-auto w-full"
      style={{ height }}
    >
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
        <defs>
          <linearGradient id="fill-views" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-views)" stopOpacity={0.22} />
            <stop offset="95%" stopColor="var(--color-views)" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="fill-uniques" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-uniques)" stopOpacity={0.10} />
            <stop offset="95%" stopColor="var(--color-uniques)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.05} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={10}
          minTickGap={48}
          tickFormatter={formatDateShort}
          stroke="currentColor"
          strokeOpacity={0.35}
          style={{ fontSize: 10.5 }}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={4}
          width={36}
          stroke="currentColor"
          strokeOpacity={0.35}
          style={{ fontSize: 10.5 }}
          allowDecimals={false}
        />
        <Tooltip
          cursor={{
            stroke: "currentColor",
            strokeOpacity: 0.20,
            strokeDasharray: "3 3",
          }}
          content={
            <ChartTooltipContent
              indicator="dot"
              labelFormatter={(label) =>
                new Date(String(label)).toLocaleDateString("en-US", {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                })
              }
            />
          }
        />
        <Area
          type="monotone"
          dataKey="views"
          stroke="var(--color-views)"
          strokeWidth={1.75}
          fill="url(#fill-views)"
          isAnimationActive={true}
          animationDuration={400}
        />
        <Area
          type="monotone"
          dataKey="uniques"
          stroke="var(--color-uniques)"
          strokeOpacity={0.55}
          strokeWidth={1.5}
          strokeDasharray="3 3"
          fill="url(#fill-uniques)"
          isAnimationActive={true}
          animationDuration={400}
          animationBegin={80}
        />
      </AreaChart>
    </ChartContainer>
  );
}

// ─── Hour-of-day bar chart (timezone-aware) ───────────────────────

const HOURLY_CHART_CONFIG: ChartConfig = {
  views: { label: "Views", color: "var(--gradient-primary)" },
};

function formatHourLabel(h: number): string {
  if (h === 0) return "12am";
  if (h === 12) return "12pm";
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

function formatHourRange(h: number): string {
  return `${formatHourLabel(h)}–${formatHourLabel((h + 1) % 24)}`;
}

interface HourBucket {
  hour: number;
  views: number;
}

function shiftToLocal(rows: HourBucket[], offsetHours: number): HourBucket[] {
  if (offsetHours === 0) return rows;
  const result: HourBucket[] = Array.from({ length: 24 }, (_, h) => ({ hour: h, views: 0 }));
  for (const r of rows) {
    const localHourFloat = ((r.hour + offsetHours) % 24 + 24) % 24;
    // Half-hour offsets (e.g. IST +5:30) round to nearest whole bucket.
    const localHour = Math.round(localHourFloat) % 24;
    result[localHour].views += r.views;
  }
  return result;
}

/**
 * Returns the user's UTC offset in hours (e.g. 5.5 for IST). Initial
 * render is 0 (SSR-safe); after mount, swaps to the browser's actual
 * offset. We deliberately don't expose a timezone name — strings like
 * "GMT+5:30" are noisy clutter, and the surrounding copy already says
 * "your local time" so the reader doesn't need a label to interpret it.
 */
function useLocalOffsetHours(): number {
  const [offset, setOffset] = React.useState(0);
  React.useEffect(() => {
    setOffset(-new Date().getTimezoneOffset() / 60);
  }, []);
  return offset;
}

/**
 * Hour-of-day breakdown card. Owns its own tz shift + peak-hour callout
 * so the whole flow is client-side and consistent. `rows` is the raw
 * 24-bucket UTC histogram from the server.
 */
export function HourlyTraffic({ rows }: { rows: HourBucket[] }) {
  const offset = useLocalOffsetHours();
  const total = rows.reduce((acc, r) => acc + r.views, 0);

  if (total === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed border-border/50 bg-muted/15 px-3 py-3 text-[12px] text-muted-foreground">
        Once visits land we&apos;ll plot when your readers show up — by hour of day.
      </div>
    );
  }

  const shifted = React.useMemo(() => shiftToLocal(rows, offset), [rows, offset]);
  const peak = shifted.reduce(
    (best, r) => (r.views > best.views ? r : best),
    shifted[0],
  );

  return (
    <div>
      <ChartContainer
        config={HOURLY_CHART_CONFIG}
        className="aspect-auto w-full"
        style={{ height: 180 }}
      >
        <BarChart data={shifted} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id="fill-hourly" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-views)" stopOpacity={0.85} />
              <stop offset="100%" stopColor="var(--color-views)" stopOpacity={0.4} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.05} />
          <XAxis
            dataKey="hour"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            interval={2}
            tickFormatter={formatHourLabel}
            stroke="currentColor"
            strokeOpacity={0.35}
            style={{ fontSize: 10.5 }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={4}
            width={32}
            stroke="currentColor"
            strokeOpacity={0.35}
            style={{ fontSize: 10.5 }}
            allowDecimals={false}
          />
          <Tooltip
            cursor={{ fill: "currentColor", fillOpacity: 0.04 }}
            content={
              <ChartTooltipContent
                indicator="dot"
                labelFormatter={(_label, payload) => {
                  const point = payload?.[0]?.payload as HourBucket | undefined;
                  if (!point || typeof point.hour !== "number") return "";
                  return formatHourRange(point.hour);
                }}
              />
            }
          />
          <Bar
            dataKey="views"
            fill="url(#fill-hourly)"
            radius={[3, 3, 0, 0]}
            isAnimationActive={true}
            animationDuration={400}
          />
        </BarChart>
      </ChartContainer>
      <p className="mt-3 text-[11.5px] text-muted-foreground">
        Peak hour:{" "}
        <span className="text-foreground/80 font-medium">
          {formatHourRange(peak.hour)}
        </span>
        <span className="text-muted-foreground/40"> · </span>
        shown in your local time
      </p>
    </div>
  );
}

// ─── Donut + filled pie (devices, browsers) ───────────────────────

/**
 * Multi-hue palette tuned for dark + light mode (oklch in globals.css).
 * Distinct hues so 85/9/6 splits are readable; chroma capped so no slice
 * screams. Cycles when there are more slices than colors.
 */
const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

function colorAt(i: number): string {
  return CHART_COLORS[i % CHART_COLORS.length];
}

interface DonutSlice {
  key: string;
  label: string;
  value: number;
}

/**
 * Pie/donut variants of the same component. `variant: "filled"` = solid pie
 * (no hole), good for small categorical breakdowns. `variant: "donut"` =
 * hollow center, room for a center label/value.
 */
export function SegmentedDonut({
  data,
  height = 220,
  variant = "donut",
  centerLabel,
  centerValue,
  colors,
}: {
  data: DonutSlice[];
  height?: number;
  variant?: "donut" | "filled";
  centerLabel?: string;
  centerValue?: string;
  /** Override the categorical palette. Useful for binary splits where
   *  the default chart-1/chart-2 hues are too similar in weight. */
  colors?: string[];
}) {
  const palette = colors ?? CHART_COLORS;
  const pick = (i: number) => palette[i % palette.length];
  const config: ChartConfig = Object.fromEntries(
    data.map((d, i) => [d.key, { label: d.label, color: pick(i) }]),
  );
  const innerRadius = variant === "filled" ? 0 : "58%";
  const showCenter = variant === "donut" && Boolean(centerValue);
  return (
    <div className="w-full" style={{ height }}>
      <ChartContainer config={config} className="aspect-auto h-full w-full">
        <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
          <Tooltip
            // shadcn canonical pattern for pie/donut: disable the cursor
            // highlight (no-op visually for pies, but matches the
            // upstream chart-pie-donut example).
            cursor={false}
            content={
              <ChartTooltipContent
                hideLabel
                nameKey="key"
                formatter={(value, _name, item) => {
                  const idx = data.findIndex((d) => d.key === item.payload?.key);
                  const cfg = config[String(item.payload?.key ?? "")];
                  return (
                    <div className="flex w-full items-center justify-between gap-4">
                      <span className="flex items-center gap-1.5">
                        <span
                          aria-hidden
                          className="size-2 rounded-[2px]"
                          style={{ background: pick(Math.max(0, idx)) }}
                        />
                        <span className="text-muted-foreground">
                          {cfg?.label ?? item.payload?.label}
                        </span>
                      </span>
                      <span className="font-mono font-medium tabular-nums text-foreground">
                        {Number(value).toLocaleString()}
                      </span>
                    </div>
                  );
                }}
              />
            }
          />
          <Pie
            data={data}
            dataKey="value"
            nameKey="key"
            innerRadius={innerRadius}
            outerRadius="92%"
            paddingAngle={variant === "filled" ? 0.8 : 1.5}
            stroke="var(--background)"
            strokeWidth={1.5}
            isAnimationActive={true}
            animationDuration={500}
          >
            {data.map((d, i) => (
              <Cell key={d.key} fill={pick(i)} />
            ))}
            {showCenter ? (
              <Label
                // Render the center label as SVG `<text>` (shadcn's
                // chart-pie-donut-text pattern). A separate absolute-
                // positioned div would sit in the same z-layer as the
                // tooltip, causing the center copy and the tooltip box
                // to bleed through each other when they overlap. As an
                // SVG primitive, the label sits *under* the tooltip's
                // bg-popover div, which cleanly covers it on hover.
                content={({ viewBox }) => {
                  if (!viewBox || !("cx" in viewBox) || !("cy" in viewBox)) {
                    return null;
                  }
                  const cx = Number(viewBox.cx ?? 0);
                  const cy = Number(viewBox.cy ?? 0);
                  return (
                    <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle">
                      {centerLabel ? (
                        <tspan
                          x={cx}
                          y={cy - 9}
                          className="fill-muted-foreground"
                          style={{
                            fontSize: 10,
                            fontWeight: 500,
                            letterSpacing: "0.08em",
                            textTransform: "uppercase",
                          }}
                        >
                          {centerLabel}
                        </tspan>
                      ) : null}
                      <tspan
                        x={cx}
                        y={centerLabel ? cy + 12 : cy}
                        className="fill-foreground"
                        style={{
                          fontSize: 22,
                          fontWeight: 600,
                          letterSpacing: "-0.01em",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {centerValue}
                      </tspan>
                    </text>
                  );
                }}
              />
            ) : null}
          </Pie>
        </PieChart>
      </ChartContainer>
    </div>
  );
}

/** Compact legend rendered next to the donut. Pass `colors` to match
 *  whatever palette the donut was rendered with. */
export function DonutLegend({
  data,
  colors,
}: {
  data: DonutSlice[];
  colors?: string[];
}) {
  const palette = colors ?? CHART_COLORS;
  const pick = (i: number) => palette[i % palette.length];
  const total = data.reduce((acc, d) => acc + d.value, 0);
  return (
    <ul className="flex flex-col gap-2 text-[12px]">
      {data.map((d, i) => {
        const pct = total > 0 ? Math.round((d.value / total) * 100) : 0;
        return (
          <li key={d.key} className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-[2px]"
              style={{ background: pick(i) }}
            />
            <span className="flex-1 truncate text-foreground/85">{d.label}</span>
            <span className="font-medium tabular-nums">{formatCount(d.value)}</span>
            <span className="w-9 text-right text-muted-foreground/80 tabular-nums">
              {pct}%
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// ─── Top sources horizontal bar chart ─────────────────────────────

interface SourceRow {
  host: string;
  views: number;
}

const SOURCES_CHART_CONFIG: ChartConfig = {
  views: { label: "Views", color: "var(--chart-1)" },
};

/**
 * Custom Y-axis tick that renders a favicon + label. Recharts passes
 * `payload.value` (the host string) and (x, y) for positioning.
 */
function SourceTick(props: {
  x?: number;
  y?: number;
  payload?: { value: string };
}) {
  const { x = 0, y = 0, payload } = props;
  const host = payload?.value ?? "";
  if (!host) return null;
  const isSentinel = SENTINEL_HOSTS.has(host);
  const label = prettyReferrer(host);
  return (
    <g transform={`translate(${x - 4}, ${y})`}>
      <foreignObject x={-150} y={-11} width={146} height={22}>
        <div className="flex h-full items-center justify-end gap-1.5 text-[11.5px] text-foreground/85">
          <span className="truncate text-right">{label}</span>
          {isSentinel ? (
            <span
              aria-hidden
              className="flex size-4 shrink-0 items-center justify-center rounded-[3px] bg-muted/50 ring-1 ring-border/40"
            >
              <span className="size-1.5 rounded-full bg-muted-foreground/70" />
            </span>
          ) : (
            <img
              src={faviconUrl(host)}
              alt=""
              width={14}
              height={14}
              className="size-3.5 shrink-0 rounded-[2px] object-contain"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          )}
        </div>
      </foreignObject>
    </g>
  );
}

export function SourcesBarChart({
  rows,
  height,
}: {
  rows: SourceRow[];
  height?: number;
}) {
  if (rows.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed border-border/50 bg-muted/15 px-3 py-3 text-[12px] text-muted-foreground">
        No traffic yet. Share your link on LinkedIn or Twitter to see sources here.
      </div>
    );
  }
  // Per-row height so the chart scales gracefully with row count.
  const computedHeight = height ?? Math.max(140, rows.length * 32 + 16);
  return (
    <ChartContainer
      config={SOURCES_CHART_CONFIG}
      className="aspect-auto w-full"
      style={{ height: computedHeight }}
    >
      <BarChart
        data={rows}
        layout="vertical"
        margin={{ top: 4, right: 32, bottom: 4, left: 156 }}
      >
        <defs>
          <linearGradient id="fill-sources" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.55} />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.95} />
          </linearGradient>
        </defs>
        <CartesianGrid horizontal={false} stroke="currentColor" strokeOpacity={0.05} />
        <XAxis
          type="number"
          tickLine={false}
          axisLine={false}
          stroke="currentColor"
          strokeOpacity={0.35}
          style={{ fontSize: 10 }}
          allowDecimals={false}
          tickFormatter={(v) => formatCount(Number(v))}
        />
        <YAxis
          type="category"
          dataKey="host"
          tickLine={false}
          axisLine={false}
          tick={<SourceTick />}
          width={150}
        />
        <Tooltip
          cursor={{ fill: "currentColor", fillOpacity: 0.04 }}
          content={
            <ChartTooltipContent
              hideLabel
              formatter={(value, _name, item) => {
                const host = String(item.payload?.host ?? "");
                return (
                  <div className="flex w-full items-center justify-between gap-4">
                    <span className="flex items-center gap-1.5">
                      <span
                        aria-hidden
                        className="size-2 rounded-[2px]"
                        style={{ background: "var(--chart-1)" }}
                      />
                      <span className="text-muted-foreground">{prettyReferrer(host)}</span>
                    </span>
                    <span className="font-mono font-medium tabular-nums text-foreground">
                      {Number(value).toLocaleString()}
                    </span>
                  </div>
                );
              }}
            />
          }
        />
        <Bar
          dataKey="views"
          fill="url(#fill-sources)"
          radius={[3, 3, 3, 3]}
          isAnimationActive={true}
          animationDuration={400}
          barSize={18}
        />
      </BarChart>
    </ChartContainer>
  );
}
