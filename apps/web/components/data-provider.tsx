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
  /**
   * `true` when the request landed on a customer's custom domain.
   * Drives URL construction throughout the portfolio subtree — see
   * `useUrlPrefix()` for the canonical helper.
   */
  isCustomDomain: boolean;
  /**
   * Prefix to prepend to internal portfolio links.
   *   - canonical (gitshow.io): `/{handle}` → links like `/yatendra2001/blog`
   *   - custom domain:           `""`        → links like `/blog`
   *
   * Use `urlPrefix + "/blog"` (NOT a leading slash on the suffix). The
   * homepage is the one exception — use `urlPrefix || "/"` to avoid
   * an empty `href`.
   */
  urlPrefix: string;
}

const Ctx = createContext<CtxValue | null>(null);

export interface DataProviderProps {
  resume: Resume;
  handle: string;
  /** `true` when serving on a customer's own domain. Defaults to `false`. */
  isCustomDomain?: boolean;
  children: React.ReactNode;
}

export function DataProvider({
  resume,
  handle,
  isCustomDomain = false,
  children,
}: DataProviderProps) {
  const value = useMemo<CtxValue>(() => {
    const urlPrefix = isCustomDomain ? "" : `/${handle}`;
    return {
      data: resumeToTemplateData(resume, handle, urlPrefix),
      resume,
      handle,
      isCustomDomain,
      urlPrefix,
    };
  }, [resume, handle, isCustomDomain]);
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

/**
 * Path prefix for every internal portfolio link.
 *
 * Returns `"/{handle}"` on the canonical site (`gitshow.io`) and `""`
 * when the request landed on a customer's custom domain. Always pair
 * the returned value with a leading-slash suffix:
 *
 *   `${urlPrefix}/blog`            // ✓ "/yatendra2001/blog" or "/blog"
 *   `${urlPrefix}/blog/${slug}`    // ✓
 *   `${urlPrefix || "/"}`          // ✓ home (avoid empty href)
 */
export function useUrlPrefix(): string {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error(
      "useUrlPrefix() must be used inside a <DataProvider>. Wrap the /{handle} route tree.",
    );
  }
  return v.urlPrefix;
}

/** True when the portfolio is being served on a customer's custom domain. */
export function useIsCustomDomain(): boolean {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error(
      "useIsCustomDomain() must be used inside a <DataProvider>. Wrap the /{handle} route tree.",
    );
  }
  return v.isCustomDomain;
}
