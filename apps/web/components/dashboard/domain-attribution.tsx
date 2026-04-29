/**
 * Custom-domain attribution card. Shows the share of traffic that
 * arrived via the user's custom domain vs the canonical gitshow.io URL.
 *
 * Only renders when:
 *   - The user has an active custom domain attached, AND
 *   - There's at least one view in the window.
 *
 * Renders a single bar with two stacked segments + readable counts.
 * No icons, no gradients, no hover — premium quiet (DESIGN.md §1).
 */

import Link from "next/link";
import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import { Icon } from "./icon";
import type { AttributionSplit } from "@/lib/analytics";
import { formatCount } from "./format";
import { cn } from "@/lib/utils";

export function DomainAttributionCard({
  split,
  customHostname,
}: {
  split: AttributionSplit;
  customHostname: string;
}) {
  if (!split.total) return null;
  const customPct = split.customSharePct ?? 0;
  const canonicalPct = 100 - customPct;
  const dominantCustom = customPct >= 50;
  return (
    <div className="rounded-2xl border border-border/50 bg-card/60 p-5">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-semibold leading-tight tracking-tight">
            Your domain
          </h3>
          <p className="mt-1 text-[11.5px] text-muted-foreground/80 leading-tight">
            How visitors are finding you
          </p>
        </div>
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
      <div className="mt-4 flex items-baseline gap-2 tabular-nums">
        <span className="text-[28px] font-semibold tracking-tight leading-none">
          {customPct}%
        </span>
        <span className="text-[12px] text-muted-foreground">
          via {customHostname}
        </span>
      </div>
      <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-foreground/[0.04]">
        <div
          aria-hidden
          className={cn(
            "h-full rounded-l-full",
            dominantCustom ? "bg-foreground" : "bg-foreground/70",
          )}
          style={{ width: `${customPct}%` }}
        />
        <div
          aria-hidden
          className="h-full rounded-r-full bg-foreground/[0.10]"
          style={{ width: `${canonicalPct}%` }}
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-muted-foreground tabular-nums">
        <span>
          <span className="text-foreground font-medium">
            {formatCount(split.customViews)}
          </span>{" "}
          via {customHostname}
        </span>
        <span>
          <span className="text-foreground font-medium">
            {formatCount(split.canonicalViews)}
          </span>{" "}
          via gitshow.io
        </span>
      </div>
    </div>
  );
}
