"use client";

import { createContext, useContext, useMemo } from "react";
import {
  resumeToTemplateData,
  type TemplateData,
} from "@/lib/resume-to-data";
import type { Resume } from "@gitshow/shared/resume";

/**
 * Two views over the same backing `Resume`:
 *
 *   - `useData()` returns the legacy template-shape `TemplateData` (icons
 *     as React components, socials keyed uppercase). All template
 *     components in `components/section/**` consume this.
 *   - `useResume()` returns the raw `Resume` JSON. New section components
 *     in `components/sections/**` (publications, hackathons) consume this
 *     directly because their props are typed against the canonical
 *     entry schemas in `@gitshow/shared/resume`.
 *
 * Keeping both lets us migrate sections one-by-one without forcing a
 * full template rewrite.
 */

interface CtxValue {
  data: TemplateData;
  resume: Resume;
  handle: string;
}

const Ctx = createContext<CtxValue | null>(null);

export interface DataProviderProps {
  resume: Resume;
  handle: string;
  children: React.ReactNode;
}

export function DataProvider({ resume, handle, children }: DataProviderProps) {
  const value = useMemo<CtxValue>(
    () => ({ data: resumeToTemplateData(resume, handle), resume, handle }),
    [resume, handle],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData(): TemplateData {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error(
      "useData() must be used inside a <DataProvider>. Wrap the /{handle} route tree.",
    );
  }
  return v.data;
}

export function useResume(): Resume {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error(
      "useResume() must be used inside a <DataProvider>. Wrap the /{handle} route tree.",
    );
  }
  return v.resume;
}

export function useHandle(): string {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error(
      "useHandle() must be used inside a <DataProvider>. Wrap the /{handle} route tree.",
    );
  }
  return v.handle;
}
