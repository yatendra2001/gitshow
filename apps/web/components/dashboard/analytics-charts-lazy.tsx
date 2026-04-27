"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "./skeleton";

/**
 * Client-side lazy wrappers for the recharts visuals. Why:
 *
 *   - `analytics-charts.tsx` pulls the entire recharts bundle (~175KB
 *     gzipped). The dashboard's home page (`/app`) imports it
 *     statically, which means Next ships those bytes for EVERY
 *     surface — non-Pro showcase, scanning state, empty state, draft
 *     review — even though only the "published with data" surface
 *     ever renders a chart.
 *   - Splitting via `dynamic()` keeps recharts in its own chunk, so
 *     the route's main client bundle is tens of KB instead of
 *     hundreds. The chart chunk only loads when the user lands on a
 *     view that actually renders one.
 *   - `ssr: true` (the default) keeps the SSR'd HTML so first paint
 *     of the published dashboard still includes the chart shapes;
 *     the dynamic wrapper only changes the JS bundle layout.
 */

export const ViewsAreaChart = dynamic(
  () => import("./analytics-charts").then((m) => m.ViewsAreaChart),
  {
    loading: () => <Skeleton className="h-[280px] w-full rounded-xl" />,
  },
);

export const HourlyTraffic = dynamic(
  () => import("./analytics-charts").then((m) => m.HourlyTraffic),
  {
    loading: () => <Skeleton className="h-[140px] w-full rounded-xl" />,
  },
);

export const SourcesBarChart = dynamic(
  () => import("./analytics-charts").then((m) => m.SourcesBarChart),
  {
    loading: () => <Skeleton className="h-[220px] w-full rounded-xl" />,
  },
);
