"use client";

import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, Search, X } from "lucide-react";
import {
  resolveSkillIcon,
  KNOWN_SKILL_ICON_KEYS,
} from "@/components/skill-icons";
import { cn } from "@/lib/utils";

/**
 * Searchable icon dropdown for the Skills editor. Replaces the raw
 * `iconKey` text input so users don't have to guess which slugs are
 * available — each option renders its brand mark alongside the slug,
 * and a fuzzy-enough `includes` search handles the long tail.
 *
 * Selecting "Text-only (no icon)" clears the iconKey so the skill
 * renders as a plain pill — same semantics as leaving the old text
 * input empty.
 */

export interface SkillIconPickerProps {
  /** Current iconKey slug. `undefined` means no icon / text-only. */
  value: string | undefined;
  onChange: (next: string | undefined) => void;
  /** Field label shown above the trigger. */
  label?: string;
  /** Small helper line under the trigger. */
  hint?: string;
  id?: string;
}

export function SkillIconPicker({
  value,
  onChange,
  label = "Icon",
  hint,
  id,
}: SkillIconPickerProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Auto-focus the search on open so you can type immediately.
  React.useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 20);
      return () => clearTimeout(t);
    } else {
      setQuery("");
    }
  }, [open]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!q) return KNOWN_SKILL_ICON_KEYS;
    return KNOWN_SKILL_ICON_KEYS.filter((k) => k.includes(q));
  }, [query]);

  const CurrentIcon = resolveSkillIcon(value);

  return (
    <div className="flex flex-col gap-1.5">
      {label ? (
        <label
          htmlFor={id}
          className="text-[12px] text-foreground font-medium"
        >
          {label}
        </label>
      ) : null}
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            id={id}
            type="button"
            className={cn(
              "flex items-center gap-2 w-full rounded-xl border border-border/40 bg-card/30 px-3 py-2 text-[13px] min-h-10",
              "hover:bg-card/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/40 transition-colors",
            )}
            aria-haspopup="listbox"
            aria-expanded={open}
          >
            {value && CurrentIcon ? (
              <>
                <CurrentIcon className="size-4 shrink-0" />
                <span className="font-mono truncate">{value}</span>
              </>
            ) : (
              <span className="text-muted-foreground">
                Text-only (no icon)
              </span>
            )}
            <ChevronDown
              className={cn(
                "ml-auto size-3.5 text-muted-foreground transition-transform",
                open && "rotate-180",
              )}
            />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={6}
            className={cn(
              "z-50 w-[var(--radix-popover-trigger-width)] rounded-xl border border-border/40 bg-card shadow-lg overflow-hidden",
              "data-[state=open]:animate-in data-[state=closed]:animate-out",
              "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
              "data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
            )}
          >
            <div className="flex items-center gap-2 border-b border-border/40 px-3 py-2">
              <Search className="size-3.5 shrink-0 text-muted-foreground" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search icons…"
                className="flex-1 bg-transparent text-[12.5px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </div>
            <ul className="max-h-64 overflow-y-auto py-1" role="listbox">
              <PickerOption
                isSelected={!value}
                onSelect={() => {
                  onChange(undefined);
                  setOpen(false);
                }}
              >
                <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-[5px] border border-dashed border-muted-foreground/40" />
                <span className="text-muted-foreground">
                  Text-only (no icon)
                </span>
              </PickerOption>
              {filtered.length === 0 ? (
                <li className="px-3 py-3 text-[12px] text-muted-foreground text-center">
                  No icons match &quot;{query}&quot;. Use text-only above.
                </li>
              ) : (
                filtered.map((slug) => {
                  const Icon = resolveSkillIcon(slug);
                  return (
                    <PickerOption
                      key={slug}
                      isSelected={slug === value}
                      onSelect={() => {
                        onChange(slug);
                        setOpen(false);
                      }}
                    >
                      {Icon ? <Icon className="size-4 shrink-0" /> : null}
                      <span className="font-mono text-[12.5px]">{slug}</span>
                    </PickerOption>
                  );
                })
              )}
            </ul>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {hint ? (
        <span className="text-[11px] text-muted-foreground">{hint}</span>
      ) : null}
    </div>
  );
}

function PickerOption({
  isSelected,
  onSelect,
  children,
}: {
  isSelected: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        role="option"
        aria-selected={isSelected}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-1.5 text-[12.5px] text-left",
          "hover:bg-accent/40 focus:bg-accent/40 focus:outline-none",
          isSelected && "bg-accent/30",
        )}
      >
        {children}
        {isSelected ? (
          <Check className="ml-auto size-3.5 text-[var(--primary)]" />
        ) : null}
      </button>
    </li>
  );
}
