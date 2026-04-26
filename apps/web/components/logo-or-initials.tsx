/* eslint-disable @next/next/no-img-element */
"use client";
import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Logo with an initials-avatar fallback.
 *
 * Tries to render `src` if provided; if it errors OR no src exists,
 * falls through to a circle with 1-2 initials taken from `name` on
 * a deterministic background colour. Replaces the previous "blank
 * muted circle" placeholder used in work-section + portfolio-page,
 * which left companies/schools with no Clearbit/favicon hit looking
 * like an empty grey dot.
 */
export function LogoOrInitials({
  src,
  name,
  className,
}: {
  src?: string;
  name: string;
  className?: string;
}) {
  const [errored, setErrored] = useState(false);
  const showImage = !!src && !errored;
  const sizing =
    className ??
    "size-8 md:size-10 border rounded-full shadow ring-2 ring-border flex-none";

  if (showImage) {
    return (
      <img
        src={src}
        alt={name}
        className={cn(sizing, "p-1 overflow-hidden object-contain")}
        onError={() => setErrored(true)}
      />
    );
  }

  return (
    <div
      className={cn(sizing, "flex items-center justify-center text-white font-semibold text-[11px] md:text-[13px] select-none")}
      style={{ backgroundColor: colorFromName(name) }}
      aria-label={name}
    >
      {initialsFromName(name)}
    </div>
  );
}

/** First letter of the first 1-2 words, uppercased. "GitHub Inc" → "GI". */
function initialsFromName(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 1).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/**
 * Pick one of N stable, contrast-safe colours from a hash of the
 * name. Same name always produces the same colour, so a company
 * keeps its avatar across page loads. Palette tuned for white text.
 */
const PALETTE = [
  "#1f6feb", // blue
  "#7c3aed", // violet
  "#db2777", // pink
  "#ea580c", // orange
  "#16a34a", // green
  "#0891b2", // cyan
  "#ca8a04", // amber
  "#dc2626", // red
  "#0d9488", // teal
  "#7c2d12", // brown
];
function colorFromName(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(h) % PALETTE.length];
}
