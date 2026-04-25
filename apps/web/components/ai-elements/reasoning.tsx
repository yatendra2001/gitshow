"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { ShimmeringText } from "@/components/ui/shimmering-text";
import { Matrix, loader } from "@/components/ui/matrix";

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
        // Subtle hairline left rule instead of a heavy bordered card.
        // Pulls the eye into the indented body without competing
        // visually with the surrounding phase rows.
        "gs-enter relative pl-4 border-l border-border/40",
        streaming && "border-l-foreground/30",
        className,
      )}
      {...props}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 py-1.5 text-left group"
      >
        {streaming ? (
          // Tiny dot-matrix loader as the "thinking" indicator. Lives
          // in 6×6 SVG cells, ~10px, animates at 14fps. Subtle enough
          // to sit next to body text without screaming.
          <Matrix
            rows={6}
            cols={6}
            frames={loader}
            fps={14}
            size={2}
            gap={1}
            ariaLabel="Thinking"
            className="shrink-0 opacity-60"
          />
        ) : (
          <span className="size-2.5 rounded-full bg-muted-foreground/40 shrink-0" />
        )}
        <span className="flex-1 text-[12.5px] font-medium tracking-tight">
          {streaming ? (
            <ShimmeringText
              text={label}
              duration={2.4}
              spread={1.4}
              className="text-foreground/55"
            />
          ) : (
            <span className="text-muted-foreground">
              Thought for {seconds}s
            </span>
          )}
        </span>
        <ChevronDown
          className={cn(
            "size-3.5 text-muted-foreground/60 transition-transform duration-200",
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
              "gs-pane-scroll max-h-64 overflow-y-auto pb-2 pr-1",
              // Smaller, lower-contrast text for a "scratchpad" feel.
              "font-sans text-[12.5px] leading-[1.7] text-foreground/70",
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
 * Tiny markdown renderer tailored for reasoning blocks. No external
 * parser (streamdown/react-markdown's dep tree pushed the Worker bundle
 * over Cloudflare's 3 MiB limit). Handles exactly what the agent emits:
 *
 *   - paragraphs (blank-line separated)
 *   - ordered lists (`1. `, `2. `) and unordered (`- ` / `* `)
 *   - headings (`#`, `##`, `###`)
 *   - `**bold**`, `*italic*`, ``inline code``
 *   - fenced code blocks (```)
 *   - inline links [text](url)
 *
 * Also normalizes OpenRouter's one-token-per-line streaming into
 * flowing paragraphs — without that, every token becomes a hard break.
 */
function ReasoningBody({
  text,
  streaming,
}: {
  text: string;
  streaming: boolean;
}) {
  const blocks = React.useMemo(() => parseMarkdown(text), [text]);
  return (
    // gs-stream gives every direct child (rendered markdown block) a
    // brief fade + blur entry — so as the model streams, new
    // paragraphs glide in instead of popping. See globals.css for
    // the keyframes + reduced-motion overrides.
    <div className="gs-stream">
      {blocks.map((b, i) => renderBlock(b, i))}
      {streaming ? (
        <span className="gs-caret ml-[2px] inline-block h-[0.9em] w-[2px] translate-y-[2px] bg-foreground/40" />
      ) : null}
    </div>
  );
}

type Block =
  | { kind: "p"; text: string }
  | { kind: "h"; level: 1 | 2 | 3; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "pre"; text: string; lang?: string }
  | { kind: "blockquote"; text: string };

function parseMarkdown(raw: string): Block[] {
  // Normalize fragmented streaming (one token per line). Skip when fenced
  // blocks are present so code blocks keep their intentional newlines.
  const source = raw.includes("```") ? raw : denseifyStreamingLines(raw);

  const out: Block[] = [];
  const lines = source.split("\n");
  let i = 0;

  const isULItem = (l: string) => /^\s*[-*]\s+/.test(l);
  const isOLItem = (l: string) => /^\s*\d+\.\s+/.test(l);

  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // Fenced code block
    if (trimmed.startsWith("```")) {
      const lang = trimmed.slice(3).trim() || undefined;
      i++;
      const codeLines: string[] = [];
      while (i < lines.length && !lines[i]!.trim().startsWith("```")) {
        codeLines.push(lines[i]!);
        i++;
      }
      if (i < lines.length) i++; // consume closing fence
      out.push({ kind: "pre", text: codeLines.join("\n"), lang });
      continue;
    }

    // Heading
    const h = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (h) {
      out.push({
        kind: "h",
        level: h[1]!.length as 1 | 2 | 3,
        text: h[2]!.trim(),
      });
      i++;
      continue;
    }

    // Blockquote
    if (trimmed.startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith(">")) {
        quoteLines.push(lines[i]!.trim().replace(/^>\s?/, ""));
        i++;
      }
      out.push({ kind: "blockquote", text: quoteLines.join(" ") });
      continue;
    }

    // Unordered list
    if (isULItem(line)) {
      const items: string[] = [];
      while (i < lines.length && isULItem(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*[-*]\s+/, "").trim());
        i++;
      }
      out.push({ kind: "ul", items });
      continue;
    }

    // Ordered list
    if (isOLItem(line)) {
      const items: string[] = [];
      while (i < lines.length && isOLItem(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*\d+\.\s+/, "").trim());
        i++;
      }
      out.push({ kind: "ol", items });
      continue;
    }

    // Paragraph — collect until blank or block change.
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      !lines[i]!.trim().startsWith("```") &&
      !/^(#{1,3})\s+/.test(lines[i]!.trim()) &&
      !lines[i]!.trim().startsWith(">") &&
      !isULItem(lines[i]!) &&
      !isOLItem(lines[i]!)
    ) {
      paraLines.push(lines[i]!.trim());
      i++;
    }
    out.push({ kind: "p", text: paraLines.join(" ") });
  }
  return out;
}

function denseifyStreamingLines(raw: string): string {
  return raw
    .split(/\n{2,}/)
    .map((para) => {
      const lines = para.split("\n");
      const isFragmented =
        lines.length > 3 &&
        lines.every((l) => l.trim().split(/\s+/).length <= 2);
      return isFragmented
        ? lines.join(" ").replace(/\s+/g, " ").trim()
        : para;
    })
    .join("\n\n");
}

function renderBlock(b: Block, key: number): React.ReactNode {
  switch (b.kind) {
    case "h":
      return b.level === 1 ? (
        <h1 key={key} className="text-[15px] font-semibold mt-3 mb-1.5 first:mt-0">
          {renderInline(b.text)}
        </h1>
      ) : b.level === 2 ? (
        <h2 key={key} className="text-[14px] font-semibold mt-3 mb-1.5 first:mt-0">
          {renderInline(b.text)}
        </h2>
      ) : (
        <h3 key={key} className="text-[13px] font-semibold mt-2 mb-1 first:mt-0">
          {renderInline(b.text)}
        </h3>
      );
    case "p":
      return (
        <p key={key} className="my-1.5 first:mt-0 last:mb-0">
          {renderInline(b.text)}
        </p>
      );
    case "ul":
      return (
        <ul key={key} className="list-disc pl-5 my-1.5 space-y-0.5 marker:text-muted-foreground/50">
          {b.items.map((it, j) => (
            <li key={j}>{renderInline(it)}</li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol key={key} className="list-decimal pl-5 my-1.5 space-y-0.5 marker:text-muted-foreground/50">
          {b.items.map((it, j) => (
            <li key={j}>{renderInline(it)}</li>
          ))}
        </ol>
      );
    case "pre":
      return (
        <pre
          key={key}
          className="bg-muted/60 rounded-md p-2 my-2 text-[12px] leading-relaxed overflow-x-auto font-mono"
        >
          {b.text}
        </pre>
      );
    case "blockquote":
      return (
        <blockquote
          key={key}
          className="border-l-2 border-border pl-3 text-muted-foreground my-2"
        >
          {renderInline(b.text)}
        </blockquote>
      );
  }
}

/** Inline: `**bold**`, `*italic*`, backtick code, and [link](url). */
function renderInline(text: string): React.ReactNode {
  const out: React.ReactNode[] = [];
  const re = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0]!;
    if (tok.startsWith("**") && tok.endsWith("**")) {
      out.push(
        <strong key={key++} className="font-semibold text-foreground">
          {tok.slice(2, -2)}
        </strong>,
      );
    } else if (tok.startsWith("*") && tok.endsWith("*")) {
      out.push(
        <em key={key++} className="italic">
          {tok.slice(1, -1)}
        </em>,
      );
    } else if (tok.startsWith("`") && tok.endsWith("`")) {
      out.push(
        <code
          key={key++}
          className="rounded bg-muted px-1 py-[1px] text-[12px] font-mono"
        >
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith("[")) {
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok);
      if (linkMatch) {
        out.push(
          <a
            key={key++}
            href={linkMatch[2]}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 text-[var(--primary)]"
          >
            {linkMatch[1]}
          </a>,
        );
      } else {
        out.push(tok);
      }
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
