"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Shared form primitives for the editor. Deliberately small — the
 * editor has a lot of section forms and any ceremony per-field
 * compounds.
 */

export function InputField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  hint,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: "text" | "url" | "email" | "date";
  hint?: string;
  required?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] text-foreground font-medium">
        {label}
        {required ? <span className="text-[var(--destructive)]"> *</span> : null}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="rounded-xl border border-border/50 bg-card/30 px-3 py-2 text-[13px] leading-relaxed placeholder:text-muted-foreground/35 focus:outline-none focus:shadow-[var(--shadow-composer-focus)] transition-shadow duration-200 min-h-10"
      />
      {hint ? (
        <span className="text-[11px] text-muted-foreground">{hint}</span>
      ) : null}
    </label>
  );
}

export function TextareaField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  rows = 5,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  rows?: number;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] text-foreground font-medium">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="rounded-xl border border-border/50 bg-card/30 px-3 py-2 text-[13px] leading-relaxed placeholder:text-muted-foreground/35 focus:outline-none focus:shadow-[var(--shadow-composer-focus)] transition-shadow duration-200 font-mono"
      />
      {hint ? (
        <span className="text-[11px] text-muted-foreground">{hint}</span>
      ) : null}
    </label>
  );
}

/**
 * Chip/tag input — replaces the broken "comma-separated" textarea
 * pattern. Each value renders as a removable chip; new values commit
 * on Enter, Tab, or comma. Backspace on an empty input removes the
 * last chip. Duplicates and empty strings are rejected.
 */
export function TagsField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  max,
}: {
  label: string;
  value: readonly string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  hint?: string;
  max?: number;
}) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = (raw: string) => {
    const tag = raw.trim();
    if (!tag) return;
    if (value.includes(tag)) {
      setDraft("");
      return;
    }
    if (max !== undefined && value.length >= max) return;
    onChange([...value, tag]);
    setDraft("");
  };

  const remove = (i: number) => onChange(value.filter((_, j) => j !== i));

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "," || e.key === "Tab") {
      if (draft.trim().length === 0) {
        if (e.key === "Tab") return;
        e.preventDefault();
        return;
      }
      e.preventDefault();
      commit(draft);
      return;
    }
    if (e.key === "Backspace" && draft.length === 0 && value.length > 0) {
      e.preventDefault();
      remove(value.length - 1);
    }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (!text.includes(",") && !text.includes("\n")) return;
    e.preventDefault();
    const parts = text.split(/[,\n]/);
    const next = [...value];
    for (const p of parts) {
      const t = p.trim();
      if (!t || next.includes(t)) continue;
      if (max !== undefined && next.length >= max) break;
      next.push(t);
    }
    onChange(next);
    setDraft("");
  };

  const atMax = max !== undefined && value.length >= max;

  return (
    <label className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-foreground font-medium">{label}</span>
        {max !== undefined ? (
          <span className="text-[11px] text-muted-foreground">
            {value.length} / {max}
          </span>
        ) : null}
      </div>
      <div
        onClick={() => inputRef.current?.focus()}
        className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border/50 bg-card/30 px-2 py-1.5 min-h-10 focus-within:shadow-[var(--shadow-composer-focus)] transition-shadow duration-200 cursor-text"
      >
        {value.map((tag, i) => (
          <span
            key={`${tag}-${i}`}
            className="inline-flex items-center gap-1 rounded-md border border-border/50 bg-background/60 px-2 py-0.5 text-[12px] text-foreground"
          >
            {tag}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                remove(i);
              }}
              aria-label={`Remove ${tag}`}
              className="text-muted-foreground hover:text-[var(--destructive)] transition-colors leading-none"
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={() => commit(draft)}
          placeholder={value.length === 0 ? placeholder : atMax ? "" : "Add…"}
          disabled={atMax}
          className="flex-1 min-w-[80px] bg-transparent border-0 outline-none text-[13px] placeholder:text-muted-foreground/35 px-1 py-0.5 disabled:cursor-not-allowed"
        />
      </div>
      {hint ? (
        <span className="text-[11px] text-muted-foreground">{hint}</span>
      ) : null}
    </label>
  );
}

export function CheckboxField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <label className="flex items-center gap-2">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 rounded border-border/50 accent-foreground"
      />
      <span className="text-[13px] text-foreground">{label}</span>
      {hint ? (
        <span className="text-[11px] text-muted-foreground ml-2">{hint}</span>
      ) : null}
    </label>
  );
}

export function SelectField<V extends string>({
  label,
  value,
  onChange,
  options,
  hint,
}: {
  label: string;
  value: V;
  onChange: (v: V) => void;
  options: { value: V; label: string }[];
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] text-foreground font-medium">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as V)}
        className="rounded-xl border border-border/50 bg-card/30 px-3 py-2 text-[13px] focus:outline-none focus:shadow-[var(--shadow-composer-focus)] transition-shadow duration-200 min-h-10"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint ? (
        <span className="text-[11px] text-muted-foreground">{hint}</span>
      ) : null}
    </label>
  );
}

/**
 * Uploader that POSTs to /api/resume/upload and writes the returned
 * URL back to the caller via `onUploaded`. Renders the current value
 * as a thumbnail when set; falls back to a drop-zone-styled input.
 */
export function MediaUploadField({
  label,
  value,
  onChange,
  accept = "image/*",
  hint,
}: {
  label: string;
  value: string | undefined;
  onChange: (url: string | undefined) => void;
  accept?: string;
  hint?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onPick = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const resp = await fetch("/api/resume/upload", {
        method: "POST",
        body: form,
      });
      if (!resp.ok) {
        const e = (await resp.json().catch(() => ({}))) as { error?: string; detail?: string };
        setError(e.detail ?? e.error ?? "Upload failed");
        return;
      }
      const data = (await resp.json()) as { url: string };
      onChange(data.url);
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[12px] text-foreground font-medium">{label}</span>
      <div className="flex items-center gap-3">
        {value ? (
          accept.includes("video") ? (
            <video
              src={value}
              className="size-14 rounded-lg border border-border object-cover"
              muted
              loop
              autoPlay
              playsInline
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={value}
              alt=""
              className="size-14 rounded-lg border border-border object-cover"
            />
          )
        ) : (
          <div className="size-14 rounded-lg border border-dashed border-border/60 bg-card/30 flex items-center justify-center text-[10px] text-muted-foreground/60">
            none
          </div>
        )}
        <label className="flex-1 cursor-pointer rounded-xl border border-border/40 bg-card/30 px-3 py-2 text-[13px] text-muted-foreground select-none transition-[background-color,border-color,color] duration-[140ms] ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-card/50 hover:border-foreground/25 hover:text-foreground active:scale-[0.98] focus-within:ring-2 focus-within:ring-ring/60 focus-within:ring-offset-2 focus-within:ring-offset-background">
          {busy ? "Uploading…" : value ? "Replace" : "Upload"}
          <input
            type="file"
            accept={accept}
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onPick(f);
            }}
          />
        </label>
        {value ? (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className="rounded-xl border border-border/40 px-3 py-2 text-[12px] text-muted-foreground select-none transition-[background-color,border-color,color,transform] duration-[140ms] ease-[cubic-bezier(0.4,0,0.2,1)] hover:text-foreground hover:border-foreground/30 hover:bg-foreground/[0.04] active:scale-[0.97] active:duration-[80ms] outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Clear
          </button>
        ) : null}
      </div>
      {hint ? (
        <span className="text-[11px] text-muted-foreground">{hint}</span>
      ) : null}
      {error ? (
        <span className="text-[11px] text-[var(--destructive)]">{error}</span>
      ) : null}
    </div>
  );
}

/**
 * Generic list editor. Renders each item via `renderItem`, adds an
 * "Add" button that appends a new item via `factory`, and supports
 * remove + reorder affordances.
 */
export function ListEditor<T>({
  label,
  items,
  onChange,
  renderItem,
  factory,
  addLabel = "Add",
  emptyLabel = "No items yet.",
  max,
}: {
  label: string;
  items: T[];
  onChange: (next: T[]) => void;
  renderItem: (item: T, index: number, onItemChange: (next: T) => void) => ReactNode;
  factory: () => T;
  addLabel?: string;
  emptyLabel?: string;
  max?: number;
}) {
  const set = (i: number, next: T) => {
    const clone = [...items];
    clone[i] = next;
    onChange(clone);
  };
  const remove = (i: number) => onChange(items.filter((_, j) => j !== i));
  const move = (i: number, dir: -1 | 1) => {
    const target = i + dir;
    if (target < 0 || target >= items.length) return;
    const clone = [...items];
    [clone[i], clone[target]] = [clone[target], clone[i]];
    onChange(clone);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-foreground font-medium">{label}</span>
        {max !== undefined ? (
          <span className="text-[11px] text-muted-foreground">
            {items.length} / {max}
          </span>
        ) : null}
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/40 p-4 text-[12px] text-muted-foreground text-center">
          {emptyLabel}
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        {items.map((item, i) => (
          <div
            key={i}
            className="rounded-xl border border-border/40 bg-card/40 p-4 relative"
          >
            <div className="absolute top-2 right-2 flex items-center gap-1">
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                aria-label="Move up"
                className={cn(
                  "h-6 w-6 rounded border border-border/40 text-[10px] text-muted-foreground select-none transition-[background-color,border-color,color,transform] duration-[140ms] ease-[cubic-bezier(0.4,0,0.2,1)] hover:text-foreground hover:border-foreground/30 hover:bg-foreground/[0.04] active:scale-90 active:duration-[80ms] outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                  i === 0 && "opacity-30 cursor-not-allowed",
                )}
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => move(i, +1)}
                disabled={i === items.length - 1}
                aria-label="Move down"
                className={cn(
                  "h-6 w-6 rounded border border-border/40 text-[10px] text-muted-foreground select-none transition-[background-color,border-color,color,transform] duration-[140ms] ease-[cubic-bezier(0.4,0,0.2,1)] hover:text-foreground hover:border-foreground/30 hover:bg-foreground/[0.04] active:scale-90 active:duration-[80ms] outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                  i === items.length - 1 && "opacity-30 cursor-not-allowed",
                )}
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label="Remove"
                className="h-6 w-6 rounded border border-border/40 text-[11px] text-muted-foreground hover:text-[var(--destructive)] hover:border-[var(--destructive)]/50 transition-colors"
              >
                ✕
              </button>
            </div>
            <div className="pr-24">{renderItem(item, i, (next) => set(i, next))}</div>
          </div>
        ))}
      </div>

      {max === undefined || items.length < max ? (
        <button
          type="button"
          onClick={() => onChange([...items, factory()])}
          className="self-start rounded-xl border border-border/40 bg-card/30 px-3 py-2 text-[12px] text-muted-foreground hover:text-foreground hover:bg-card/50 transition-colors"
        >
          + {addLabel}
        </button>
      ) : null}
    </div>
  );
}
