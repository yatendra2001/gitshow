/**
 * Resume I/O — server-side read/write for the portfolio document.
 *
 * Storage model (mirrors the draft/published split discussed in planning):
 *   - `resumes/{handle}/published.json` → what renders at `/{handle}`
 *   - `resumes/{handle}/draft.json`     → editor working copy
 *
 * The handle (lowercased GitHub username) is the stable key. D1 stores
 * only pointer + metadata; R2 stores the JSON blob. On publish, the
 * backend copies draft → published and bumps `user_profiles.updated_at`.
 */

import { ResumeSchema, type Resume } from "@gitshow/shared/resume";

export function publishedResumeKey(handle: string): string {
  return `resumes/${handle.toLowerCase()}/published.json`;
}

export function draftResumeKey(handle: string): string {
  return `resumes/${handle.toLowerCase()}/draft.json`;
}

/**
 * Fetch the published Resume for a public handle. Returns null when the
 * blob is missing or unparseable. Invalid JSON is treated as missing so a
 * broken write never 500s the public page.
 */
export async function loadPublishedResume(
  bucket: R2Bucket | undefined,
  handle: string,
): Promise<Resume | null> {
  if (!bucket) return null;
  try {
    const obj = await bucket.get(publishedResumeKey(handle));
    if (!obj) return null;
    const text = await obj.text();
    const raw: unknown = JSON.parse(text);
    const parsed = ResumeSchema.safeParse(raw);
    if (!parsed.success) {
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

/**
 * Fetch the draft Resume for an authenticated editor. Same failure
 * semantics as `loadPublishedResume`.
 */
export async function loadDraftResume(
  bucket: R2Bucket | undefined,
  handle: string,
): Promise<Resume | null> {
  if (!bucket) return null;
  try {
    const obj = await bucket.get(draftResumeKey(handle));
    if (!obj) return null;
    const text = await obj.text();
    const raw: unknown = JSON.parse(text);
    const parsed = ResumeSchema.safeParse(raw);
    if (!parsed.success) return null;
    return parsed.data;
  } catch {
    return null;
  }
}
