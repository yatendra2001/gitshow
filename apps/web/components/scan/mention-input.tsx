"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { PromptInput } from "@/components/ai-elements/prompt-input";

/**
 * Revise-chat input with @mention targeting.
 *
 * Typing `@` opens a popover with claim targets: `@hook`, `@numbers`,
 * `@disclosure`, `@pattern-N`, `@shipped-...`. Picking one inserts the
 * mention token into the textarea AND records the chosen claim in
 * `mentions` state, which the parent reads before submitting — so we
 * keep the parsing / resolution out of the server and make the LLM's
 * job unambiguous.
 *
 * Design note: we intentionally don't use a full rich-text editor
 * (tiptap/lexical). Plain textarea + regex + popover keeps the
 * dependency surface tiny and matches the "chip-like token in plain
 * text" pattern Slack/Linear use.
 */

export interface MentionTarget {
  /** Stable id (claim id, or beat-level sentinel like "beat:hook"). */
  id: string;
  /** What the user types: "hook", "pattern-ramp-speed", etc. */
  token: string;
  /** Shown in the popover row. */
  label: string;
  /** Optional one-line subtitle, e.g. the claim's first words. */
  hint?: string;
}

export interface MentionedClaim {
  id: string;
  token: string;
}

export function MentionInput({
  value,
  onChange,
  onSubmit,
  targets,
  disabled,
  placeholder,
  suggestions,
  mentionedClaim,
  onMentionChange,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (input: { text: string; mention: MentionedClaim | null }) => void;
  targets: MentionTarget[];
  disabled?: boolean;
  placeholder?: string;
  /** Suggestion chips rendered above the input. */
  suggestions?: React.ReactNode;
  mentionedClaim: MentionedClaim | null;
  onMentionChange: (m: MentionedClaim | null) => void;
}) {
  // Detect the open @-query in the value by looking at the caret position.
  // Since PromptInput swallows the ref, we use a second-pass detector:
  // strip the value to whatever comes after the last unclosed @.
  const atQuery = React.useMemo(() => extractAtQuery(value), [value]);
  const popoverOpen = atQuery !== null;

  const filtered = React.useMemo(() => {
    if (!popoverOpen) return [];
    const q = atQuery!.toLowerCase();
    if (q === "") return targets.slice(0, 8);
    return targets
      .filter(
        (t) =>
          t.token.toLowerCase().includes(q) ||
          t.label.toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [targets, atQuery, popoverOpen]);

  const pickTarget = (t: MentionTarget) => {
    // Replace the `@<q>` with `@<token> ` in the value, and record the
    // chosen claim so the submit payload carries the resolved id.
    const lastAt = value.lastIndexOf("@");
    if (lastAt === -1) return;
    const next = value.slice(0, lastAt) + `@${t.token} ` + "";
    onChange(next);
    onMentionChange({ id: t.id, token: t.token });
  };

  // If the user deletes past a mention's @, clear the pinned claim.
  React.useEffect(() => {
    if (!mentionedClaim) return;
    if (!value.includes(`@${mentionedClaim.token}`)) {
      onMentionChange(null);
    }
  }, [value, mentionedClaim, onMentionChange]);

  return (
    <div className="relative">
      {suggestions && <div className="mb-2">{suggestions}</div>}
      <PromptInput
        value={value}
        onChange={onChange}
        disabled={disabled}
        placeholder={placeholder}
        onSubmit={() =>
          onSubmit({ text: value.trim(), mention: mentionedClaim })
        }
        header={
          mentionedClaim && (
            <div className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-0.5 font-mono text-[10px] font-semibold text-foreground">
              <span className="text-blue-500">@</span>
              {mentionedClaim.token}
              <button
                type="button"
                onClick={() => {
                  onMentionChange(null);
                  onChange(
                    value.replace(
                      new RegExp(`@${escapeRegex(mentionedClaim.token)}\\s?`),
                      "",
                    ),
                  );
                }}
                className="ml-1 text-muted-foreground hover:text-foreground"
                aria-label="Unpin mention"
              >
                ×
              </button>
            </div>
          )
        }
      />

      {popoverOpen && filtered.length > 0 && (
        <div
          className={cn(
            "absolute bottom-full left-0 right-0 mb-2 max-h-60 overflow-y-auto",
            "rounded-lg border border-border bg-card shadow-lg",
          )}
        >
          <div className="px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Revise target
          </div>
          <ul className="divide-y divide-border">
            {filtered.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => pickTarget(t)}
                  className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-accent"
                >
                  <span className="mt-0.5 font-mono text-[11px] font-bold text-blue-500">
                    @{t.token}
                  </span>
                  <div className="flex-1">
                    <div className="text-xs font-semibold text-foreground">
                      {t.label}
                    </div>
                    {t.hint && (
                      <div className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
                        {t.hint}
                      </div>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────

function extractAtQuery(text: string): string | null {
  // Returns the query following the latest unclosed @ (i.e. one with no
  // whitespace after it and not already consumed by a prior pick).
  const match = text.match(/@([\w-]*)$/);
  if (!match) return null;
  return match[1];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
