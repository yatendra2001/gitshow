import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * shadcn's canonical `cn` helper — combines clsx + tailwind-merge so
 * components can accept className overrides without Tailwind ordering
 * conflicts.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
