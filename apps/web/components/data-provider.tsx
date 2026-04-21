"use client";

import { createContext, useContext, useMemo } from "react";
import {
  resumeToTemplateData,
  type TemplateData,
} from "@/lib/resume-to-data";
import type { Resume } from "@gitshow/shared/resume";

/**
 * Makes the template's `DATA` available to every section/navbar component
 * via `useData()`, so each can do `const DATA = useData()` instead of
 * `import { DATA } from "@/data/resume"`.
 *
 * The provider takes the server-loaded `Resume` (JSON) + `handle` string
 * and memoises the template-shape transform (which resolves icon keys to
 * React components on the client). This keeps the server/client boundary
 * serializable — no React components cross it — while letting the
 * unmodified template components consume a DATA object with icon
 * components as they expect.
 */

const Ctx = createContext<TemplateData | null>(null);

export interface DataProviderProps {
  resume: Resume;
  handle: string;
  children: React.ReactNode;
}

export function DataProvider({ resume, handle, children }: DataProviderProps) {
  const data = useMemo(
    () => resumeToTemplateData(resume, handle),
    [resume, handle],
  );
  return <Ctx.Provider value={data}>{children}</Ctx.Provider>;
}

export function useData(): TemplateData {
  const d = useContext(Ctx);
  if (!d) {
    throw new Error(
      "useData() must be used inside a <DataProvider>. Wrap the /{handle} route tree.",
    );
  }
  return d;
}
