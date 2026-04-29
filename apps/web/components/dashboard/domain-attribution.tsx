/**
 * Custom-domain attribution. Shows the share of traffic that arrived
 * via the user's custom domain vs the canonical gitshow.io URL.
 *
 * Only renders when:
 *   - The user has an active custom domain attached, AND
 *   - There's at least one view in the window.
 *
 * Visual: a donut + legend, sitting next to "Top sources" in a 2-col
 * grid. Uses the same shadcn `--chart-*` palette as Devices/Browsers
 * so the dashboard reads as a single visual family.
 */

import Link from "next/link";
import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import { Icon } from "./icon";
import type { AttributionSplit } from "@/lib/analytics";
import { DonutLegend, SegmentedDonut } from "./analytics-charts";

export function DomainAttribution({
  split,
  customHostname,
}: {
  split: AttributionSplit;
  customHostname: string;
}) {
  if (!split.total) return null;
  const customPct = split.customSharePct ?? 0;
  // The user's custom domain is the focal segment, so it goes first
  // and picks up `--chart-1` (the brand-leaning hue). Canonical sits
  // on `--chart-2` like the second slice in the Browsers/Devices donuts.
  const data = [
    { key: "custom", label: customHostname, value: split.customViews },
    { key: "canonical", label: "gitshow.io", value: split.canonicalViews },
  ];
  return (
    <div className="flex h-full flex-col">
      <div className="grid flex-1 grid-cols-[1fr_auto] items-center gap-5">
        <SegmentedDonut
          data={data}
          height={180}
          variant="donut"
          centerLabel="Via your domain"
          centerValue={`${customPct}%`}
        />
        <DonutLegend data={data} />
      </div>
      <div className="mt-4 flex items-center justify-end">
        <Link
          href={`https://${customHostname}`}
          target="_blank"
          rel="noopener noreferrer"
          className="group inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04] transition-[background-color,color] duration-[140ms]"
        >
          <span className="truncate">{customHostname}</span>
          <Icon
            icon={ArrowUpRight01Icon}
            className="size-2.5 transition-transform duration-[180ms] ease-[cubic-bezier(0.215,0.61,0.355,1)] group-hover:-translate-y-px group-hover:translate-x-px"
          />
        </Link>
      </div>
    </div>
  );
}
