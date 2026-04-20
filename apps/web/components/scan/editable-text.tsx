"use client";

import * as React from "react";

/**
 * Click-to-edit text for a single claim. Replaces the old "pin it and
 * ask the AI to revise" flow — the user is the editor now, not the LLM.
 *
 * Visual contract:
 *  - Display mode: the text styled by the parent (we inherit font/size).
 *    A hover outline hints "click me"; no visible chrome otherwise.
 *  - Edit mode: a textarea that grows with content, an explicit Save
 *    and Cancel, Enter-submits (Shift+Enter newline), Esc cancels.
 *  - Saving: PATCHes /api/claims/<id> with action=edit. On success the
 *    parent-provided onSaved runs so the card's local state can reflect.
 *
 * The underlying D1 row stays the same — .text column is overwritten,
 * .original_text preserved, .status flips to user_edited. That means
 * every downstream consumer (profile-card, public /{handle} view
 * after Publish, exports) picks up edits without any other plumbing.
 */

export interface EditableTextProps {
  claimId: string;
  value: string;
  onSaved: (next: string) => void;
  /** Extra classes for the container. */
  className?: string;
  /** Inline styles forwarded to BOTH display and input — keeps typography identical. */
  style?: React.CSSProperties;
  /** Treat Enter as submit (default true). Disable for disclosure / paragraphs where newlines matter. */
  singleLine?: boolean;
  /** Render children when the user is NOT editing. We delegate display
   *  rendering to the caller so it can inject markdown, clamps, etc. */
  children: React.ReactNode;
  /** Placeholder shown inside the textarea when the value is empty. */
  placeholder?: string;
  /** Optional hover hint; the default "Click to edit" covers most cases. */
  hoverHint?: string;
}

export function EditableText({
  claimId,
  value,
  onSaved,
  className,
  style,
  singleLine = false,
  children,
  placeholder,
  hoverHint = "Click to edit",
}: EditableTextProps) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const [saving, setSaving] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const taRef = React.useRef<HTMLTextAreaElement | null>(null);

  // Auto-resize the textarea to fit content so edit mode visually
  // matches display mode.
  const resize = React.useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }, []);

  React.useEffect(() => {
    if (editing) {
      setDraft(value);
      setErr(null);
      // Focus + resize after mount.
      requestAnimationFrame(() => {
        taRef.current?.focus();
        taRef.current?.select();
        resize();
      });
    }
  }, [editing, value, resize]);

  const save = async () => {
    const next = draft.trim();
    if (!next) {
      setErr("Can't be empty.");
      return;
    }
    if (next === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const resp = await fetch(`/api/claims/${encodeURIComponent(claimId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "edit", text: next }),
      });
      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(body.slice(0, 160) || `HTTP ${resp.status}`);
      }
      onSaved(next);
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <span
        className={className}
        style={{
          ...style,
          cursor: "text",
          borderRadius: 6,
          padding: "2px 4px",
          margin: "-2px -4px",
          transition: "background 160ms ease",
          display: style?.display ?? "inline",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLSpanElement).style.background =
            "rgba(59, 130, 246, 0.08)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLSpanElement).style.background = "transparent";
        }}
        onClick={(e) => {
          const t = e.target as HTMLElement;
          if (t.closest("a,button")) return;
          e.stopPropagation();
          setEditing(true);
        }}
        title={hoverHint}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setEditing(true);
          }
        }}
      >
        {children}
      </span>
    );
  }

  return (
    <span className={className} style={{ display: "block", ...style }}>
      <textarea
        ref={taRef}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          resize();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            setEditing(false);
            return;
          }
          if (e.key === "Enter" && (singleLine ? true : (e.metaKey || e.ctrlKey))) {
            e.preventDefault();
            void save();
            return;
          }
        }}
        disabled={saving}
        placeholder={placeholder}
        rows={singleLine ? 1 : 3}
        style={{
          width: "100%",
          fontFamily: "inherit",
          fontSize: "inherit",
          lineHeight: "inherit",
          letterSpacing: "inherit",
          color: "inherit",
          background: "rgba(59, 130, 246, 0.04)",
          border: "1px solid rgba(59, 130, 246, 0.35)",
          borderRadius: 6,
          padding: "6px 10px",
          margin: 0,
          outline: "none",
          resize: "none",
          boxSizing: "border-box",
          minHeight: singleLine ? "1.5em" : "3em",
        }}
      />
      <span
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginTop: 6,
          fontSize: 11,
          fontFamily: `var(--font-mono), monospace`,
          color: "#475569",
        }}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void save();
          }}
          disabled={saving}
          style={{
            background: "#0F172A",
            color: "white",
            border: "none",
            borderRadius: 4,
            padding: "4px 10px",
            fontFamily: "inherit",
            fontSize: 11,
            cursor: saving ? "default" : "pointer",
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setEditing(false);
          }}
          disabled={saving}
          style={{
            background: "transparent",
            color: "#64748B",
            border: "none",
            padding: "4px 6px",
            fontFamily: "inherit",
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
        <span style={{ fontSize: 10, color: "#94A3B8" }}>
          {singleLine ? "Enter saves" : "⌘⏎ saves"} · Esc cancels
        </span>
        {err ? <span style={{ color: "#EF4444" }}>{err}</span> : null}
      </span>
    </span>
  );
}
