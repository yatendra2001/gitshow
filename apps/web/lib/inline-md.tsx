"use client";

import * as React from "react";

/**
 * Tiny inline-markdown renderer + auto-emphasis pass used by the profile
 * card's prose bodies. Keeps three jobs small and cheap:
 *
 *   1. Parse `**bold**` → <strong>, `*italic*` → <em>, and backtick
 *      `code` → <code>. No links, no lists, no paragraph parsing.
 *      (LLM-authored claim text is plain prose — we just want to let
 *      authors bold the key phrase if they pass one in.)
 *
 *   2. Auto-emphasize anything that looks like a KPI in the text —
 *      numbers (with units + suffixes), percentages, star counts, and
 *      repo slugs (owner/name). Runs AFTER explicit markdown so an
 *      author's `**bold**` always wins.
 *
 *   3. Fall through to plain text for anything else.
 *
 * Returns an array of ReactNodes rather than HTML so React handles
 * keying and server-side rendering without dangerouslySetInnerHTML.
 */

/** Patterns we consider KPIs worth emphasizing automatically. */
const AUTO_BOLD_RE =
  // owner/repo slug  |  percentages  |  star counts  |  plain numbers w/ units
  /\b([a-zA-Z0-9][\w.-]*\/[\w.-]+)\b|\b(\d{1,3}(?:,\d{3})*(?:\.\d+)?%)|\b(\d{1,3}(?:\.\d+)?[kKmM]?\+?\s*(?:★|stars?|commits?|repos?|PRs?|days?|weeks?|months?|years?|contributors?|engineers?|lines?|hours?|minutes?|features?|fixes?|reviews?))\b|\b(\d{4}[/-]\d{1,2}(?:[/-]\d{1,2})?)\b|\b(\d{1,3}(?:,\d{3})+)\b/g;

/** Already-handled markdown spans so we don't double-process. */
const MD_RE = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/;

export function InlineMarkdown({
  text,
  autoBold = true,
  className,
}: {
  text: string;
  autoBold?: boolean;
  className?: string;
}) {
  const nodes = React.useMemo(
    () => renderInline(text, autoBold),
    [text, autoBold],
  );
  if (className) {
    return <span className={className}>{nodes}</span>;
  }
  return <>{nodes}</>;
}

function renderInline(text: string, autoBold: boolean): React.ReactNode[] {
  // Split on explicit markdown spans so we preserve them.
  const parts = text.split(MD_RE);
  const out: React.ReactNode[] = [];
  parts.forEach((part, i) => {
    if (!part) return;
    if (part.startsWith("**") && part.endsWith("**")) {
      out.push(<strong key={i}>{part.slice(2, -2)}</strong>);
      return;
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      out.push(<em key={i}>{part.slice(1, -1)}</em>);
      return;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      out.push(
        <code
          key={i}
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "0.9em",
            padding: "1px 5px",
            background: "rgba(0,0,0,0.05)",
            borderRadius: 3,
          }}
        >
          {part.slice(1, -1)}
        </code>,
      );
      return;
    }
    // Plain text — optionally auto-bold KPIs.
    if (!autoBold) {
      out.push(<React.Fragment key={i}>{part}</React.Fragment>);
      return;
    }
    out.push(...autoEmphasize(part, `p${i}`));
  });
  return out;
}

function autoEmphasize(text: string, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let lastIdx = 0;
  let matchIdx = 0;
  AUTO_BOLD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = AUTO_BOLD_RE.exec(text)) !== null) {
    const span = m[0];
    if (m.index > lastIdx) {
      out.push(
        <React.Fragment key={`${keyPrefix}-t${matchIdx}`}>
          {text.slice(lastIdx, m.index)}
        </React.Fragment>,
      );
    }
    out.push(
      <strong
        key={`${keyPrefix}-b${matchIdx}`}
        style={{ fontWeight: 700 }}
      >
        {span}
      </strong>,
    );
    lastIdx = m.index + span.length;
    matchIdx++;
  }
  if (lastIdx < text.length) {
    out.push(
      <React.Fragment key={`${keyPrefix}-tail`}>
        {text.slice(lastIdx)}
      </React.Fragment>,
    );
  }
  return out;
}

/**
 * Wraps a long prose block in a 3-line clamp with a "Show more" toggle.
 * Uses CSS line-clamp (not height) so no JS-measured heights, no
 * layout shift on first paint.
 */
export function ClampedProse({
  text,
  lines = 4,
  className,
  style,
}: {
  text: string;
  lines?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [expanded, setExpanded] = React.useState(false);
  // Only show the toggle if the text is long enough to plausibly overflow.
  const likelyOverflows = text.length > 220;
  return (
    <div style={style} className={className}>
      <div
        style={{
          display: "-webkit-box",
          WebkitLineClamp: expanded ? "none" : lines,
          WebkitBoxOrient: "vertical",
          overflow: expanded ? "visible" : "hidden",
        }}
      >
        <InlineMarkdown text={text} />
      </div>
      {likelyOverflows && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          style={{
            marginTop: 6,
            padding: 0,
            border: "none",
            background: "none",
            fontSize: 11,
            fontWeight: 600,
            fontFamily: "var(--font-mono)",
            color: "#3B82F6",
            cursor: "pointer",
          }}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
