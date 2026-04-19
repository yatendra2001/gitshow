"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { SendHorizonal } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

/**
 * PromptInput — the submit box at the bottom of the chat pane. Minimal
 * API inspired by AI Elements: controlled value, onSubmit(value), a
 * submit button (enter / cmd-enter) and a right-side slot for the
 * scope chip / attachments.
 *
 * Expands height with content up to a cap; shrinks back on clear.
 */

export interface PromptInputProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Slot for scope chip / attachments / token badges above the textarea. */
  header?: React.ReactNode;
  /** Slot for icon buttons on the left side of the footer row. */
  leftTools?: React.ReactNode;
  className?: string;
}

export function PromptInput({
  value,
  onChange,
  onSubmit,
  placeholder = "Describe what you want gitshow to do…",
  disabled,
  header,
  leftTools,
  className,
}: PromptInputProps) {
  const ref = React.useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea to fit content up to ~9 rows.
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [value]);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className={cn(
        "rounded-xl border border-border bg-card shadow-sm",
        "focus-within:border-foreground/40 focus-within:shadow-md",
        "transition-colors",
        className,
      )}
    >
      {header && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 pt-2 pb-2">
          {header}
        </div>
      )}
      <div className="px-3 pt-3">
        <Textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className="min-h-[44px] resize-none border-0 bg-transparent p-0 text-sm leading-relaxed focus-visible:ring-0 focus-visible:ring-offset-0"
        />
      </div>
      <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-1">
        <div className="flex items-center gap-2 text-muted-foreground">
          {leftTools}
        </div>
        <button
          type="submit"
          disabled={disabled || value.trim().length === 0}
          className={cn(
            "inline-flex h-8 w-8 items-center justify-center rounded-md",
            "bg-foreground text-background",
            "transition-opacity hover:opacity-90",
            "disabled:cursor-not-allowed disabled:opacity-40",
          )}
          aria-label="Send"
        >
          <SendHorizonal className="size-3.5" />
        </button>
      </div>
    </form>
  );
}

export function PromptInputFooterHint({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "mt-2 px-1 text-[10px] font-mono text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
