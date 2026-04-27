/**
 * Template component registry.
 *
 * Resolves a `TemplateId` to a React component. Used by:
 *   - `app/[handle]/page.tsx` — public render
 *   - `app/app/(dashboard)/preview/page.tsx` — owner draft preview
 *   - The preview chooser to swap variants without republishing
 *
 * Each template owns its full chrome (background, navbar, page wrapper),
 * so the parent layout only provides DataProvider.
 *
 * Code splitting: each template is wrapped in `next/dynamic` so it
 * lives in its own chunk. The registry no longer pulls all six into
 * the route bundle — only the selected variant downloads. Public
 * portfolio pages save ~2MB; the preview surface pays a small chunk
 * fetch on each template-switch (subsequent switches are cached).
 *
 * `ssr: true` (default) keeps server-rendered HTML so first paint of
 * a public portfolio is instant — only the JS bundle is split.
 */

import dynamic from "next/dynamic";
import type { TemplateId } from "@gitshow/shared/resume";

const COMPONENTS: Record<TemplateId, React.ComponentType> = {
  classic: dynamic(() => import("./classic")),
  terminal: dynamic(() => import("./terminal")),
  spotlight: dynamic(() => import("./spotlight")),
  glow: dynamic(() => import("./glow")),
  bento: dynamic(() => import("./bento")),
  minimal: dynamic(() => import("./minimal")),
};

export function getTemplateComponent(id: string | undefined | null): React.ComponentType {
  if (id && id in COMPONENTS) return COMPONENTS[id as TemplateId];
  return COMPONENTS.classic;
}

export { TEMPLATES, TEMPLATE_BY_ID, DEFAULT_TEMPLATE_ID, getTemplateMeta } from "./registry";
export type { TemplateMeta } from "./registry";
