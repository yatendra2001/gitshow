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
    id: "spotlight",
    name: "Spotlight",
    tagline: "Two-column with a sticky identity panel and cursor-tracking glow.",
    bestFor: "Senior FE/full-stack engineers — the most cloned dev portfolio on the internet.",
    vibes: ["serious", "two-column", "navy"],
    swatch: { bg: "#0a192f", fg: "#ccd6f6", accent: "#64ffda" },
    preferredMode: "dark",
  },
  {
    id: "glow",
    name: "Glow",
    tagline: "Animated dark hero, gradient name, marquee tech logos, glowing project cards.",
    bestFor: "AI builders, indie hackers, and anyone shipping shadcn-grade UI today.",
    vibes: ["modern", "animated", "linear"],
    swatch: { bg: "#0a0a0a", fg: "#fafafa", accent: "#bd9bff" },
    preferredMode: "dark",
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
    id: "terminal",
    name: "Terminal",
    tagline: "CLI aesthetic — VS Code palette, real syntax highlighting, vim status bar.",
    bestFor: "Backend, infra, security, and lower-level engineers who live in a shell.",
    vibes: ["hacker", "mono", "retro"],
    swatch: { bg: "#0d1117", fg: "#d4d4d4", accent: "#7fff7f" },
    preferredMode: "dark",
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
