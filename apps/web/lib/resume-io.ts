/**
 * Resume I/O — server-side read/write for the portfolio document.
 *
 * Storage model:
 *   - `resumes/{handle}/published.json` → what renders at `/{handle}`
 *   - `resumes/{handle}/draft.json`     → editor working copy
 *
 * The handle (lowercased GitHub username) is the stable key. D1 stores
 * only pointer + metadata; R2 stores the JSON blob. On publish, the
 * backend copies draft → published.
 */

import { ResumeSchema, type Resume } from "@gitshow/shared/resume";

export function publishedResumeKey(handle: string): string {
  return `resumes/${handle.toLowerCase()}/published.json`;
}

export function draftResumeKey(handle: string): string {
  return `resumes/${handle.toLowerCase()}/draft.json`;
}

export async function loadPublishedResume(
  bucket: R2Bucket | undefined,
  handle: string,
): Promise<Resume | null> {
  return loadResumeAt(bucket, publishedResumeKey(handle));
}

export async function loadDraftResume(
  bucket: R2Bucket | undefined,
  handle: string,
): Promise<Resume | null> {
  return loadResumeAt(bucket, draftResumeKey(handle));
}

async function loadResumeAt(
  bucket: R2Bucket | undefined,
  key: string,
): Promise<Resume | null> {
  if (!bucket) return null;
  try {
    const obj = await bucket.get(key);
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

/**
 * Write a validated Resume to `resumes/{handle}/draft.json`. Bumps
 * `meta.version` + `meta.updatedAt` so downstream optimistic-concurrency
 * checks can tell the blob has changed.
 *
 * Returns the final Resume written (with bumped meta).
 */
export async function writeDraftResume(
  bucket: R2Bucket,
  handle: string,
  resume: Resume,
): Promise<Resume> {
  const next: Resume = {
    ...resume,
    meta: {
      ...resume.meta,
      version: (resume.meta.version ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    },
  };
  await bucket.put(draftResumeKey(handle), JSON.stringify(next, null, 2), {
    httpMetadata: { contentType: "application/json" },
  });
  return next;
}

/**
 * Deep-merge a Partial<Resume> patch onto the existing draft, validate
 * the result against the Zod schema, and write it back to R2. Arrays
 * are REPLACED (not merged per-index) — callers pass the full new
 * array when editing list sections.
 *
 * Returns the new Resume on success, or `{ error }` on validation
 * failure so the caller can surface the issues to the editor UI without
 * bricking the draft.
 */
export async function patchDraftResume(
  bucket: R2Bucket,
  handle: string,
  patch: unknown,
):
  Promise<
    | { ok: true; resume: Resume }
    | { ok: false; error: string; issues?: unknown }
  > {
  const current = await loadDraftResume(bucket, handle);
  if (!current) {
    return { ok: false, error: "no_draft" };
  }

  const merged = deepMerge(current as unknown as Record<string, unknown>, patch as Record<string, unknown>);

  const parsed = ResumeSchema.safeParse(merged);
  if (!parsed.success) {
    return { ok: false, error: "invalid_patch", issues: parsed.error.issues };
  }

  const written = await writeDraftResume(bucket, handle, parsed.data);
  return { ok: true, resume: written };
}

/**
 * Merge `patch` into `base` recursively. Arrays in the patch replace
 * arrays in base (index-level merging would be surprising for ordered
 * content). Primitives + nulls in the patch replace the base value.
 * `undefined` in the patch means "leave this field alone."
 */
export function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      out[k] = v;
      continue;
    }
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const baseVal = base[k];
      if (baseVal && typeof baseVal === "object" && !Array.isArray(baseVal)) {
        out[k] = deepMerge(
          baseVal as Record<string, unknown>,
          v as Record<string, unknown>,
        );
        continue;
      }
      out[k] = v;
      continue;
    }
    out[k] = v;
  }
  return out;
}
