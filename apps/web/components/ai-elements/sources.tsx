"use client";

import * as React from "react";
import { BookOpen, ChevronDown, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Sources — the "Used N sources" blue pill that expands to a citation list.
 * Shaped to match AI Elements' Sources component: a single blue trigger
 * row, smooth height transition on open, favicon-less but domain-labeled
 * items underneath.
 *
 * Dark-palette friendly by default; host name in monospace, title in
 * prose color.
 */

export interface SourceItem {
  id: string;
  url: string;
  title?: string;
}

export function Sources({
  items,
  className,
  label,
  ...props
}: {
  items: SourceItem[];
  label?: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  const [open, setOpen] = React.useState(false);
  if (items.length === 0) return null;

  const triggerLabel =
    label ?? `Used ${items.length} source${items.length === 1 ? "" : "s"}`;

  return (
    <div
      className={cn(
        "gs-enter rounded-xl border border-border bg-card/70 backdrop-blur-sm",
        className,
      )}
      {...props}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left"
      >
        <BookOpen className="size-4 text-blue-400" />
        <span className="flex-1 text-sm font-medium text-blue-300">
          {triggerLabel}
        </span>
        <ChevronDown
          className={cn(
            "size-4 text-muted-foreground transition-transform duration-200",
            open ? "rotate-0" : "-rotate-90",
          )}
        />
      </button>

      <div
        className={cn(
          "grid overflow-hidden transition-[grid-template-rows] duration-300 ease-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="min-h-0">
          <ul className="gs-pane-scroll max-h-72 space-y-0.5 overflow-y-auto border-t border-border/60 px-2 py-1.5">
            {items.map((s) => {
              const host = safeHost(s.url);
              return (
                <li key={s.id}>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="group flex items-start gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent/40"
                  >
                    <BookOpen className="mt-0.5 size-3.5 shrink-0 text-blue-400/80" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-blue-300 group-hover:underline">
                        {s.title ?? host}
                      </div>
                      <div className="truncate font-mono text-[10px] text-muted-foreground">
                        {host}
                      </div>
                    </div>
                    <ExternalLink className="mt-1 size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
