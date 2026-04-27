"use client";

import { useResume } from "@/components/data-provider";
import { getTemplateComponent } from "@/components/templates";

/**
 * Public portfolio render at `/{handle}`. The parent
 * `app/[handle]/layout.tsx` loads the Resume from R2 and wires the
 * DataProvider; we look up the template component the user picked
 * (defaults to "classic") and render it.
 */
export default function Page() {
  const resume = useResume();
  const Template = getTemplateComponent(resume.theme.template);
  return <Template />;
}
