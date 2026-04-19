"use client";

import * as React from "react";
import { BookOpen, ChevronDown, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * LiveSources — accumulating list of URLs the pipeline has touched.
 *
 * Shows the domain, a short label, and opens the real URL on click.
 * Collapsed by default; a single pill "Used N sources" mirrors the
 * AI Elements Sources component's look.
 *
 * We don't try to fetch favicons (extra network, flicker). The small
 * BookOpen icon reads as "reference" fine.
 */

export interface LiveSource {
  id: string;
  url: string;
  title?: string;
  kind?: "commit" | "pr" | "repo" | "web" | "review" | "issue";
}

export function LiveSources({
  sources,
  className,
  ...props
}: {
  sources: LiveSource[];
} & React.HTMLAttributes<HTMLDivElement>) {
  const [open, setOpen] = React.useState(false);

  if (sources.length === 0) return null;

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card/60",
        className,
      )}
      {...props}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-blue-600 hover:text-blue-700"
      >
        <ChevronDown
          className={cn(
            "size-3 transition-transform",
            open ? "" : "-rotate-90",
          )}
        />
        Used {sources.length} source{sources.length === 1 ? "" : "s"}
      </button>
      {open && (
        <div className="max-h-64 space-y-0.5 overflow-y-auto border-t border-border px-3 py-2">
          {sources.map((s) => {
            let host = "";
            try {
              host = new URL(s.url).hostname.replace(/^www\./, "");
            } catch {
              host = s.url;
            }
            return (
              <a
                key={s.id}
                href={s.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-start gap-2 rounded-md px-2 py-1 text-sm transition-colors hover:bg-accent"
              >
                <BookOpen className="mt-0.5 size-3.5 shrink-0 text-blue-500" />
                <div className="flex-1 min-w-0">
                  <div className="truncate text-blue-600 hover:underline">
                    {s.title ?? host}
                  </div>
                  <div className="truncate font-mono text-[10px] text-muted-foreground">
                    {host}
                  </div>
                </div>
                <ExternalLink className="mt-1 size-3 shrink-0 text-muted-foreground" />
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
