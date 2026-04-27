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
 */

import type { TemplateId } from "@gitshow/shared/resume";
import ClassicTemplate from "./classic";
import TerminalTemplate from "./terminal";
import MagazineTemplate from "./magazine";
import BentoTemplate from "./bento";
import BrutalistTemplate from "./brutalist";
import MinimalTemplate from "./minimal";

const COMPONENTS: Record<TemplateId, React.ComponentType> = {
  classic: ClassicTemplate,
  terminal: TerminalTemplate,
  magazine: MagazineTemplate,
  bento: BentoTemplate,
  brutalist: BrutalistTemplate,
  minimal: MinimalTemplate,
};

export function getTemplateComponent(id: string | undefined | null): React.ComponentType {
  if (id && id in COMPONENTS) return COMPONENTS[id as TemplateId];
  return COMPONENTS.classic;
}

export { TEMPLATES, TEMPLATE_BY_ID, DEFAULT_TEMPLATE_ID, getTemplateMeta } from "./registry";
export type { TemplateMeta } from "./registry";
