"use client";

import * as React from "react";
import { Brain, ChevronDown } from "lucide-react";
import { Streamdown } from "streamdown";
import { cn } from "@/lib/utils";

/**
 * Reasoning — the "Thought for Xs" collapsible. Streams text in while
 * the agent is thinking; after it completes, the block collapses to
 * just the header with the elapsed time. Click the header to re-open.
 *
 * Design:
 *   - header: brain icon, "Thinking" (streaming) or "Thought for Xs"
 *     (done), chevron
 *   - body: monospace-ish serif at reduced size + leading; each word
 *     fades+blurs in on mount via gs-stream
 *   - a blinking caret pulses at the tail while streaming
 *   - auto-collapses on completion after a ~600ms pause
 */

export interface ReasoningProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Live reasoning text. Append-only as new tokens arrive. */
  text: string;
  /** True while text is still being appended. Flip false when done. */
  streaming?: boolean;
  /** Manual duration override for the "Thought for Xs" label; otherwise
   * we derive it from the time between first mount and `streaming=false`. */
  elapsedMs?: number;
  /** Shown above the body while active. Defaults to "Thinking". */
  label?: string;
  /** Stay open after streaming ends (useful for debugging). Default false. */
  keepOpenAfterDone?: boolean;
}

export function Reasoning({
  text,
  streaming = false,
  elapsedMs,
  label = "Thinking",
  keepOpenAfterDone = false,
  className,
  ...props
}: ReasoningProps) {
  const [open, setOpen] = React.useState(true);
  const mountedAt = React.useRef(Date.now());
  const [derivedMs, setDerivedMs] = React.useState(0);

  // Track stream-end for auto-collapse.
  const wasStreaming = React.useRef(streaming);
  React.useEffect(() => {
    if (wasStreaming.current && !streaming) {
      if (elapsedMs === undefined) {
        setDerivedMs(Date.now() - mountedAt.current);
      }
      if (!keepOpenAfterDone) {
        const t = setTimeout(() => setOpen(false), 700);
        return () => clearTimeout(t);
      }
    }
    wasStreaming.current = streaming;
  }, [streaming, elapsedMs, keepOpenAfterDone]);

  const seconds = Math.max(
    1,
    Math.round((elapsedMs ?? derivedMs) / 1000),
  );
  const headerLabel = streaming ? label : `Thought for ${seconds}s`;

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
        className={cn(
          "flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors",
          "hover:bg-accent/40",
        )}
      >
        <Brain
          className={cn(
            "size-4 text-blue-400",
            streaming && "gs-pulse",
          )}
        />
        <span className="flex-1 text-sm font-medium text-foreground/90">
          {headerLabel}
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
          <div
            className={cn(
              "gs-pane-scroll max-h-64 overflow-y-auto border-t border-border/60 px-4 py-3",
              // Sans at [13px]/1.65 matches chatbot's reasoning rhythm —
              // serif felt out of place for an agent scratchpad. Markdown
              // goes through Streamdown so **bold**, lists, and code
              // blocks render as you'd expect.
              "font-sans text-[13px] leading-[1.65] text-foreground/85",
              "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-[1px] [&_code]:text-[12px] [&_code]:font-mono",
              "[&_pre]:bg-muted/60 [&_pre]:rounded-md [&_pre]:p-2 [&_pre]:text-[12px] [&_pre]:leading-relaxed [&_pre]:overflow-x-auto [&_pre]:my-2",
              "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
              "[&_h1]:text-[15px] [&_h1]:font-semibold [&_h1]:mt-3 [&_h1]:mb-1.5",
              "[&_h2]:text-[14px] [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1.5",
              "[&_h3]:text-[13px] [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1",
              "[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-1.5 [&_ul]:space-y-0.5",
              "[&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-1.5 [&_ol]:space-y-0.5",
              "[&_li]:marker:text-muted-foreground/50",
              "[&_p]:my-1.5 first:[&_p]:mt-0 last:[&_p]:mb-0",
              "[&_strong]:font-semibold [&_strong]:text-foreground",
              "[&_em]:italic",
              "[&_a]:underline [&_a]:underline-offset-2 [&_a]:text-[var(--primary)]",
              "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_blockquote]:my-2",
            )}
          >
            <ReasoningBody text={text} streaming={streaming} />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Renders the streaming text as markdown via Streamdown. Streamdown is
 * built for append-only streams: it only re-parses the suffix that
 * changed so rendering stays cheap as tokens arrive. Caret appears at
 * the tail while streaming.
 *
 * Some upstream reasoning payloads come in as soft-wrapped lines (one
 * word per line) when OpenRouter's SDK emits fine-grained chunks. We
 * lightly normalize that before feeding to the parser so bullets and
 * paragraphs stay intact — without swallowing intentional line breaks
 * in code blocks.
 */
function ReasoningBody({
  text,
  streaming,
}: {
  text: string;
  streaming: boolean;
}) {
  const normalized = React.useMemo(() => normalizeReasoning(text), [text]);
  return (
    <div className="whitespace-pre-wrap">
      <Streamdown>{normalized}</Streamdown>
      {streaming ? (
        <span className="gs-caret ml-[2px] inline-block h-[0.9em] w-[2px] translate-y-[2px] bg-blue-400" />
      ) : null}
    </div>
  );
}

function normalizeReasoning(raw: string): string {
  // Skip normalization for anything that looks like it already contains
  // code/fenced blocks — they're intentionally line-sensitive.
  if (raw.includes("```")) return raw;
  // Join runs of single-word lines into flowing paragraphs. OpenRouter's
  // streaming sometimes emits each token on its own line which the
  // markdown parser would otherwise render as a hard-break soup.
  return raw
    .split(/\n{2,}/)
    .map((para) => {
      const lines = para.split("\n");
      const isFragmented =
        lines.length > 3 && lines.every((l) => l.trim().split(/\s+/).length <= 2);
      return isFragmented ? lines.join(" ").replace(/\s+/g, " ").trim() : para;
    })
    .join("\n\n");
}
