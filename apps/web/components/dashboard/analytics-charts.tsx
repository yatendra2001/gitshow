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
  CartesianGrid,
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
import { formatDateShort } from "./format";

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
