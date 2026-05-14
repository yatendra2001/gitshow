"use client";

/**
 * Shared shell for every `/app/resume/*` route — a sticky toolbar with
 * a persistent tabs bar on the left and a page-specific `trailing`
 * slot on the right.
 *
 * Two tabs:
 *   - "Resume"            → /app/resume               (base editor)
 *   - "Tailored versions" → /app/resume/tailored      (list view)
 *
 * The third route (`/app/resume/tailored/[id]`) keeps the Tailored tab
 * active — it's a sub-surface of the same section. Tabs follow the
 * sidebar nav guidance from DESIGN.md §6: active state is static (no
 * fade), hover is a 140ms color/bg transition, and the tab itself
 * does NOT animate when toggling active state (would flicker on RSC
 * re-render).
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type ResumeTabKey = "base" | "tailored";

export function ResumeShellToolbar({
  active,
  tailoredCount,
  trailing,
}: {
  active: ResumeTabKey;
  tailoredCount: number;
  trailing?: ReactNode;
}) {
  return (
    <div className="sticky top-14 z-10 flex items-center gap-3 border-b border-border/30 bg-background/85 backdrop-blur px-5 h-14">
      <ResumeTabsBar active={active} tailoredCount={tailoredCount} />
      {trailing ? (
        <div className="ml-auto flex items-center gap-2">{trailing}</div>
      ) : null}
    </div>
  );
}

export function ResumeTabsBar({
  active,
  tailoredCount,
}: {
  active: ResumeTabKey;
  tailoredCount: number;
}) {
  return (
    <nav
      className="inline-flex items-center gap-1"
      aria-label="Resume sections"
    >
      <TabLink href="/app/resume" active={active === "base"}>
        Resume
      </TabLink>
      <TabLink
        href="/app/resume/tailored"
        active={active === "tailored"}
        count={tailoredCount}
      >
        Tailored versions
      </TabLink>
    </nav>
  );
}

function TabLink({
  href,
  active,
  count,
  children,
}: {
  href: string;
  active: boolean;
  count?: number;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md h-8 px-2.5 text-[12.5px] font-medium",
        "transition-[background-color,color] duration-150 ease",
        active
          ? "bg-foreground/[0.06] text-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]",
        "min-h-9 outline-none focus-visible:ring-2 focus-visible:ring-foreground/20",
      )}
    >
      <span>{children}</span>
      {typeof count === "number" && count > 0 ? (
        <span
          className={cn(
            "inline-flex items-center justify-center rounded-full px-1.5 h-4 min-w-4 text-[10.5px] tabular-nums",
            active
              ? "bg-foreground/10 text-foreground"
              : "bg-foreground/[0.06] text-muted-foreground",
          )}
        >
          {count}
        </span>
      ) : null}
    </Link>
  );
}
