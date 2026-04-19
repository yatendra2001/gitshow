"use client";

import * as React from "react";
import { ChevronDown, Copy, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Terminal — visible ANSI log viewer. Unlike the previous
 * hidden-behind-toggle version, this one renders inline by default and
 * hides only via an explicit user collapse. Matches the AI Elements
 * reference: dark header bar with copy + clear glyphs, monospace body,
 * color tokens for keywords (info, warn, success), auto-scroll pinned
 * to bottom while tailing.
 */

const COLOR_TOKENS: Array<[RegExp, string]> = [
  [/\binfo\b/gi, "text-sky-400"],
  [/\bwarn(ing)?\b/gi, "text-amber-300"],
  [/\berror\b|\bfailed\b/gi, "text-red-400"],
  [/\b(ok|done|success|succeeded|Compiled successfully)\b/gi, "text-emerald-400"],
  [/\b(running|enter)\b/gi, "text-blue-300"],
];

export interface TerminalProps extends React.HTMLAttributes<HTMLDivElement> {
  lines: string[];
  title?: string;
  /** Cap on stored lines; defaults to 2000. */
  maxLines?: number;
  /** Hide the clear button when logs are caller-owned. */
  onClear?: () => void;
  /** Default open state. True = visible on mount. */
  defaultOpen?: boolean;
}

export function Terminal({
  lines,
  title = "Live log",
  maxLines = 2000,
  onClear,
  defaultOpen = true,
  className,
  ...props
}: TerminalProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  const [stickBottom, setStickBottom] = React.useState(true);
  const ref = React.useRef<HTMLDivElement>(null);

  const visibleLines = React.useMemo(
    () => lines.slice(-maxLines),
    [lines, maxLines],
  );

  React.useEffect(() => {
    if (!stickBottom || !open) return;
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visibleLines, stickBottom, open]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setStickBottom(atBottom);
  };

  const copy = () => {
    navigator.clipboard?.writeText(lines.join("\n")).catch(() => {});
  };

  return (
    <div
      className={cn(
        "gs-enter flex flex-col overflow-hidden rounded-xl border border-border bg-[color-mix(in_oklch,var(--background),black_30%)]",
        className,
      )}
      {...props}
    >
      <div className="flex items-center gap-2 border-b border-border/80 px-3 py-1.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 items-center gap-1.5 text-left"
          aria-label={open ? "Collapse terminal" : "Expand terminal"}
        >
          <ChevronDown
            className={cn(
              "size-3 text-muted-foreground transition-transform",
              open ? "rotate-0" : "-rotate-90",
            )}
          />
          <span className="font-mono text-[11px] text-muted-foreground">
            &gt;_ {title}
          </span>
        </button>
        <span className="font-mono text-[10px] text-muted-foreground">
          {lines.length} line{lines.length === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
          aria-label="Copy log to clipboard"
          title="Copy"
        >
          <Copy className="size-3" />
        </button>
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            className="inline-flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
            aria-label="Clear log"
            title="Clear"
          >
            <Trash2 className="size-3" />
          </button>
        )}
      </div>

      <div
        className={cn(
          "grid overflow-hidden transition-[grid-template-rows] duration-300 ease-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="min-h-0">
          <div
            ref={ref}
            onScroll={onScroll}
            className={cn(
              "gs-pane-scroll max-h-64 overflow-y-auto px-3 py-2",
              "font-mono text-[11.5px] leading-relaxed text-muted-foreground",
            )}
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {visibleLines.length === 0 ? (
              <div className="py-2 text-muted-foreground/70">
                waiting for output…
              </div>
            ) : (
              visibleLines.map((raw, i) => (
                <div
                  key={i}
                  className="gs-fade whitespace-pre-wrap break-all"
                >
                  {colorize(raw)}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function colorize(raw: string): React.ReactNode {
  // Strip the simplest ANSI color codes so we don't render them as
  // literals; then apply our own class-based coloring on keywords.
  const stripped = raw.replace(/\x1b\[[0-9;]*m/g, "");
  if (!stripped.trim()) return stripped;

  type Part = { text: string; cls?: string };
  let parts: Part[] = [{ text: stripped }];
  for (const [re, cls] of COLOR_TOKENS) {
    const next: Part[] = [];
    for (const p of parts) {
      if (p.cls) {
        next.push(p);
        continue;
      }
      let lastIdx = 0;
      const text = p.text;
      let m: RegExpExecArray | null;
      re.lastIndex = 0;
      while ((m = re.exec(text)) !== null) {
        if (m.index > lastIdx) {
          next.push({ text: text.slice(lastIdx, m.index) });
        }
        next.push({ text: m[0], cls });
        lastIdx = m.index + m[0].length;
      }
      if (lastIdx < text.length) {
        next.push({ text: text.slice(lastIdx) });
      }
    }
    parts = next;
  }

  return parts.map((p, i) =>
    p.cls ? (
      <span key={i} className={p.cls}>
        {p.text}
      </span>
    ) : (
      <React.Fragment key={i}>{p.text}</React.Fragment>
    ),
  );
}
