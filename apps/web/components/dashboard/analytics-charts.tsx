"use client";

/**
 * Recharts-backed visuals for the analytics dashboard.
 *
 * Visual rules:
 *   - Single accent color (`--gradient-primary`) for everything,
 *     differentiated by opacity. Two-tone monochrome reads more
 *     premium than blue + purple.
 *   - Sparklines have no axes, no labels — just shape.
 *   - The big chart has hairline gridlines (currentColor at 0.05) so
 *     the gridlines don't shout over the data.
 */

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
import { formatCount, formatDateShort } from "./format";

// ─── Sparkline (KPI card footer) ──────────────────────────────────

export function SparklineMini({
  data,
  color = "var(--gradient-primary)",
}: {
  data: { x: number; value: number }[];
  color?: string;
}) {
  if (!data.length) return null;
  // Stable id for the gradient definition. Recharts dedupes on this
  // string so multiple sparklines on the same page don't conflict.
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
  views: {
    label: "Views",
    color: "var(--gradient-primary)",
  },
  uniques: {
    label: "Uniques",
    color: "var(--gradient-primary)",
  },
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
      <AreaChart
        data={data}
        margin={{ top: 8, right: 8, bottom: 0, left: 4 }}
      >
        <defs>
          <linearGradient id="fill-views" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="5%"
              stopColor="var(--color-views)"
              stopOpacity={0.22}
            />
            <stop
              offset="95%"
              stopColor="var(--color-views)"
              stopOpacity={0}
            />
          </linearGradient>
          <linearGradient id="fill-uniques" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="5%"
              stopColor="var(--color-uniques)"
              stopOpacity={0.10}
            />
            <stop
              offset="95%"
              stopColor="var(--color-uniques)"
              stopOpacity={0}
            />
          </linearGradient>
        </defs>
        <CartesianGrid
          vertical={false}
          stroke="currentColor"
          strokeOpacity={0.05}
        />
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
        {/* Views: primary line, full-strength accent. */}
        <Area
          type="monotone"
          dataKey="views"
          stroke="var(--color-views)"
          strokeWidth={1.75}
          fill="url(#fill-views)"
          isAnimationActive={true}
          animationDuration={400}
        />
        {/* Uniques: same hue, lower-strength stroke + fill. */}
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

// ─── Hour-of-day bar chart ────────────────────────────────────────

const HOURLY_CHART_CONFIG: ChartConfig = {
  views: {
    label: "Views",
    color: "var(--gradient-primary)",
  },
};

/** "13" → "1pm". Drops the leading zero and lowercases the suffix. */
function formatHourLabel(h: number): string {
  if (h === 0) return "12am";
  if (h === 12) return "12pm";
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

export function HourlyBarChart({
  data,
  height = 180,
}: {
  data: { hour: number; views: number }[];
  height?: number;
}) {
  return (
    <ChartContainer
      config={HOURLY_CHART_CONFIG}
      className="aspect-auto w-full"
      style={{ height }}
    >
      <BarChart
        data={data}
        margin={{ top: 8, right: 8, bottom: 0, left: 4 }}
      >
        <defs>
          <linearGradient id="fill-hourly" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              stopColor="var(--color-views)"
              stopOpacity={0.85}
            />
            <stop
              offset="100%"
              stopColor="var(--color-views)"
              stopOpacity={0.4}
            />
          </linearGradient>
        </defs>
        <CartesianGrid
          vertical={false}
          stroke="currentColor"
          strokeOpacity={0.05}
        />
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
              labelFormatter={(label) => `${formatHourLabel(Number(label))} UTC`}
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
  );
}

// ─── Donut chart (devices, browsers) ──────────────────────────────

/**
 * Monochrome opacity ladder. Sorted descending so the largest slice
 * gets full strength and small slices fade out — same logic as the
 * single-accent rule applied to area + bar charts above.
 */
const SLICE_OPACITIES = [1, 0.78, 0.58, 0.42, 0.3, 0.2];

interface DonutSlice {
  /** Stable id used for the legend + tooltip key. */
  key: string;
  /** Display name. */
  label: string;
  value: number;
}

export function MonochromeDonut({
  data,
  height = 220,
  centerLabel,
  centerValue,
}: {
  data: DonutSlice[];
  height?: number;
  /** Small uppercase label above the big number in the donut hole. */
  centerLabel?: string;
  /** The big number itself. Pre-formatted (we don't know the metric). */
  centerValue?: string;
}) {
  const config: ChartConfig = Object.fromEntries(
    data.map((d) => [d.key, { label: d.label, color: "var(--gradient-primary)" }]),
  );
  return (
    <div className="relative w-full" style={{ height }}>
      <ChartContainer config={config} className="aspect-auto h-full w-full">
        <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
          <Tooltip
            content={
              <ChartTooltipContent
                hideLabel
                nameKey="key"
                formatter={(value, _name, item) => {
                  const cfg = config[String(item.payload?.key ?? "")];
                  return (
                    <div className="flex w-full items-center justify-between gap-4">
                      <span className="flex items-center gap-1.5">
                        <span
                          aria-hidden
                          className="size-2 rounded-[2px]"
                          style={{
                            background: "var(--gradient-primary)",
                            opacity: item.payload?.__opacity ?? 1,
                          }}
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
            data={data.map((d, i) => ({
              ...d,
              __opacity:
                SLICE_OPACITIES[i] ?? SLICE_OPACITIES[SLICE_OPACITIES.length - 1],
            }))}
            dataKey="value"
            nameKey="key"
            innerRadius="58%"
            outerRadius="92%"
            paddingAngle={1.5}
            stroke="var(--background)"
            strokeWidth={1.5}
            isAnimationActive={true}
            animationDuration={500}
          >
            {data.map((d, i) => (
              <Cell
                key={d.key}
                fill="var(--gradient-primary)"
                fillOpacity={
                  SLICE_OPACITIES[i] ?? SLICE_OPACITIES[SLICE_OPACITIES.length - 1]
                }
              />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>
      {centerValue ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          {centerLabel ? (
            <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
              {centerLabel}
            </span>
          ) : null}
          <span className="text-[22px] font-semibold leading-none tabular-nums tracking-tight">
            {centerValue}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** Compact legend rendered next to the donut. Server-renderable. */
export function DonutLegend({ data }: { data: DonutSlice[] }) {
  const total = data.reduce((acc, d) => acc + d.value, 0);
  return (
    <ul className="flex flex-col gap-2 text-[12px]">
      {data.map((d, i) => {
        const opacity = SLICE_OPACITIES[i] ?? SLICE_OPACITIES[SLICE_OPACITIES.length - 1];
        const pct = total > 0 ? Math.round((d.value / total) * 100) : 0;
        return (
          <li key={d.key} className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-[2px]"
              style={{ background: "var(--gradient-primary)", opacity }}
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
