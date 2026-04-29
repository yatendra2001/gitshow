/**
 * Custom-domain attribution. Shows the share of traffic that arrived
 * via the user's custom domain vs the canonical gitshow.io URL.
 *
 * Only renders when:
 *   - The user has an active custom domain attached, AND
 *   - There's at least one view in the window.
 *
 * Visual: a donut + legend, sitting next to "Top sources" in a 2-col
 * grid. Quieter than the chart-1/chart-2 default palette — we use
 * foreground (custom) vs muted foreground (canonical) so the user's
 * own domain reads as the hero of the split.
 */

import Link from "next/link";
import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import { Icon } from "./icon";
import type { AttributionSplit } from "@/lib/analytics";
import { DonutLegend, SegmentedDonut } from "./analytics-charts";

const DOMAIN_PALETTE = [
  "oklch(from var(--foreground) l c h / 0.78)",
  "oklch(from var(--foreground) l c h / 0.18)",
];

export function DomainAttribution({
  split,
  customHostname,
}: {
  split: AttributionSplit;
  customHostname: string;
}) {
  if (!split.total) return null;
  const customPct = split.customSharePct ?? 0;
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
          centerLabel="VIA YOUR DOMAIN"
          centerValue={`${customPct}%`}
          colors={DOMAIN_PALETTE}
        />
        <DonutLegend data={data} colors={DOMAIN_PALETTE} />
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
