"use client";

/**
 * Recharts-backed visuals for the analytics dashboard.
 *
 * Two exports:
 *   - <SparklineMini /> — 36px high, no axes, used inside KPI cards.
 *   - <ViewsAreaChart /> — the big card chart at the top of the page.
 *
 * Both use the existing ChartContainer wrapper so colors come from
 * `--color-chart-*` design tokens. Stays consistent with anything we
 * add later (top-route bar chart, weekly heatmap).
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

const SPARK_CONFIG: ChartConfig = {
  value: {
    label: "Views",
    color: "var(--gradient-primary)",
  },
};

export function SparklineMini({
  data,
  color = "var(--gradient-primary)",
}: {
  data: { x: number; value: number }[];
  color?: string;
}) {
  if (!data.length) return null;
  return (
    <div className="h-9 w-full -mx-1">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
        >
          <defs>
            <linearGradient
              id={`spark-fill-${color}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0%" stopColor={color} stopOpacity={0.5} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#spark-fill-${color})`}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

void SPARK_CONFIG; // referenced for type intent; recharts uses inline color

// ─── Big views chart ──────────────────────────────────────────────

const VIEWS_CHART_CONFIG: ChartConfig = {
  views: {
    label: "Views",
    color: "var(--gradient-primary)",
  },
  uniques: {
    label: "Unique visitors",
    color: "var(--gradient-secondary)",
  },
};

export function ViewsAreaChart({
  data,
  height = 260,
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
        margin={{ top: 8, right: 12, bottom: 0, left: -16 }}
      >
        <defs>
          <linearGradient id="fill-views" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="5%"
              stopColor="var(--color-views)"
              stopOpacity={0.32}
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
              stopOpacity={0.30}
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
          strokeOpacity={0.08}
        />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={32}
          tickFormatter={formatDateShort}
          stroke="currentColor"
          strokeOpacity={0.4}
          style={{ fontSize: 11 }}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={4}
          width={36}
          stroke="currentColor"
          strokeOpacity={0.4}
          style={{ fontSize: 11 }}
          allowDecimals={false}
        />
        <Tooltip
          cursor={{
            stroke: "var(--color-views)",
            strokeOpacity: 0.4,
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
          strokeWidth={2}
          fill="url(#fill-views)"
          stackId="a"
          isAnimationActive={true}
          animationDuration={500}
        />
        <Area
          type="monotone"
          dataKey="uniques"
          stroke="var(--color-uniques)"
          strokeWidth={2}
          fill="url(#fill-uniques)"
          isAnimationActive={true}
          animationDuration={500}
          animationBegin={120}
        />
      </AreaChart>
    </ChartContainer>
  );
}
