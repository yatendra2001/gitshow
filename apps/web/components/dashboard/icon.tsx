"use client";

import {
  HugeiconsIcon,
  type IconSvgElement,
} from "@hugeicons/react";
import { cn } from "@/lib/utils";

/**
 * Thin wrapper over `HugeiconsIcon` so the dashboard surfaces use one
 * consistent stroke weight + sizing convention.
 *
 * Sizing comes from `className` (Tailwind `size-4` etc.) — we don't
 * pass `size` to the underlying SVG because that would fight Tailwind
 * and lock the icon to a pixel value.
 *
 * Free pack is stroke-rounded only; for true duotone we'd need
 * `@hugeicons/core-pro-icons`. Stroke-rounded already reads more
 * polished than lucide's default at the dashboard's size band.
 */
export interface IconProps {
  icon: IconSvgElement;
  className?: string;
  /** Default 1.75 — slightly thinner than lucide's 2 for a calmer feel. */
  strokeWidth?: number;
  /** Aria-label for the rare standalone icon-button. */
  "aria-label"?: string;
  /** Aria-hidden — set true when the icon is decorative beside text. */
  "aria-hidden"?: boolean | "true" | "false";
}

export function Icon({
  icon,
  className,
  strokeWidth = 1.75,
  "aria-label": ariaLabel,
  "aria-hidden": ariaHidden,
}: IconProps) {
  return (
    <HugeiconsIcon
      icon={icon}
      strokeWidth={strokeWidth}
      className={cn("shrink-0", className)}
      aria-label={ariaLabel}
      aria-hidden={ariaHidden}
    />
  );
}
