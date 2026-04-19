"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Terminal — monospaced streaming log viewer. Auto-scrolls on new
 * lines as long as the user hasn't scrolled up. The Fly worker's raw
 * pino lines + per-repo clone output live here; power users open it
 * for debug, everyone else leaves it collapsed.
 */

export function Terminal({
  lines,
  className,
  ...props
}: {
  lines: string[];
} & React.HTMLAttributes<HTMLDivElement>) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [stickBottom, setStickBottom] = React.useState(true);

  React.useEffect(() => {
    if (!stickBottom) return;
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lines, stickBottom]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setStickBottom(atBottom);
  };

  return (
    <div
      className={cn(
        "flex h-64 flex-col overflow-hidden rounded-md border border-border bg-[#0b0b10] text-[11px] text-emerald-300",
        className,
      )}
      {...props}
    >
      <div className="flex items-center justify-between border-b border-border/50 bg-black/40 px-3 py-1 font-mono text-[10px] text-muted-foreground">
        <span>pipeline log</span>
        <span>{lines.length} lines</span>
      </div>
      <div
        ref={ref}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto px-3 py-2 font-mono leading-relaxed"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {lines.length === 0 ? (
          <div className="text-muted-foreground">waiting for output…</div>
        ) : (
          lines.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap break-all">
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
