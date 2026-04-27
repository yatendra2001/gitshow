/**
 * Template registry — single source of truth for the visual variants the
 * portfolio can render with. Adding a template is two lines here plus
 * the actual component.
 *
 * The registry is data-only (no React imports) so it can be safely
 * imported from server components, API routes, and the editor without
 * pulling in client-side bundles.
 */

import type { TemplateId } from "@gitshow/shared/resume";

export interface TemplateMeta {
  id: TemplateId;
  /** Display name shown in the chooser. */
  name: string;
  /** One-line description for the chooser tile. */
  tagline: string;
  /** Two-line "best for" hint shown in the chooser. */
  bestFor: string;
  /** Tone descriptors (used for filtering / search later). */
  vibes: string[];
  /** Background + foreground swatch for the chooser card preview. */
  swatch: { bg: string; fg: string; accent: string };
  /** Theme this template was built for. The chooser warns when the active
   *  theme doesn't match — e.g. terminal looks broken in light mode. */
  preferredMode: "dark" | "light" | "any";
}

export const TEMPLATES: TemplateMeta[] = [
  {
    id: "classic",
    name: "Classic",
    tagline: "Friendly scrolling portfolio with avatar, prose, and timeline sections.",
    bestFor: "Indie hackers, generalists, and anyone who wants their work to read like dillion's.",
    vibes: ["clean", "warm", "approachable"],
    swatch: { bg: "#0a0a0a", fg: "#fafafa", accent: "#3178c6" },
    preferredMode: "any",
  },
  {
    id: "terminal",
    name: "Terminal",
    tagline: "CLI aesthetic — monospace, ASCII dividers, and cursor blink.",
    bestFor: "Backend, infra, security, and lower-level engineers who live in a shell.",
    vibes: ["hacker", "mono", "retro"],
    swatch: { bg: "#0b0f0a", fg: "#7fff7f", accent: "#7fff7f" },
    preferredMode: "dark",
  },
  {
    id: "magazine",
    name: "Magazine",
    tagline: "Editorial layout — drop caps, big serif, and dramatic typographic rhythm.",
    bestFor: "Founders, writers, designers, and engineers with a story to tell.",
    vibes: ["editorial", "serif", "elegant"],
    swatch: { bg: "#f8f5ee", fg: "#171717", accent: "#b53f24" },
    preferredMode: "light",
  },
  {
    id: "bento",
    name: "Bento",
    tagline: "Apple-style bento grid — facet cards of varied size at a single glance.",
    bestFor: "Full-stack devs, product engineers, and visual thinkers.",
    vibes: ["modern", "grid", "playful"],
    swatch: { bg: "#0a0a0a", fg: "#fafafa", accent: "#a78bfa" },
    preferredMode: "dark",
  },
  {
    id: "brutalist",
    name: "Brutalist",
    tagline: "High-contrast monochrome, asymmetric grid, sharp borders, oversized type.",
    bestFor: "Creative engineers and designers who want to be remembered.",
    vibes: ["bold", "raw", "confident"],
    swatch: { bg: "#fafafa", fg: "#0a0a0a", accent: "#ff3300" },
    preferredMode: "light",
  },
  {
    id: "minimal",
    name: "Minimal",
    tagline: "One column, mono font, almost text-only. Information at maximum density.",
    bestFor: "Senior engineers, design-conscious folks, and anyone allergic to chrome.",
    vibes: ["minimal", "mono", "dense"],
    swatch: { bg: "#0a0a0a", fg: "#a3a3a3", accent: "#fafafa" },
    preferredMode: "any",
  },
];

export const TEMPLATE_BY_ID: Record<TemplateId, TemplateMeta> = TEMPLATES.reduce(
  (acc, t) => {
    acc[t.id] = t;
    return acc;
  },
  {} as Record<TemplateId, TemplateMeta>,
);

export const DEFAULT_TEMPLATE_ID: TemplateId = "classic";

export function getTemplateMeta(id: string | undefined | null): TemplateMeta {
  if (id && id in TEMPLATE_BY_ID) return TEMPLATE_BY_ID[id as TemplateId];
  return TEMPLATE_BY_ID[DEFAULT_TEMPLATE_ID];
}
