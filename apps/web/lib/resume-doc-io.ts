/**
 * ResumeDoc I/O — server-side read/write for the printable resume.
 *
 * Storage: `resumes/{handle}/resume-doc.json` in R2. Single blob per
 * user — no draft/published split (the resume is always the export-
 * ready document). The handle (lowercased GitHub login) is the key.
 */

import {
  ResumeDocSchema,
  type ResumeDoc,
} from "@gitshow/shared/resume-doc";

export function resumeDocKey(handle: string): string {
  return `resumes/${handle.toLowerCase()}/resume-doc.json`;
}

export async function loadResumeDoc(
  bucket: R2Bucket | undefined,
  handle: string,
): Promise<ResumeDoc | null> {
  if (!bucket) return null;
  try {
    const obj = await bucket.get(resumeDocKey(handle));
    if (!obj) return null;
    const text = await obj.text();
    const raw: unknown = JSON.parse(text);
    const parsed = ResumeDocSchema.safeParse(raw);
    if (!parsed.success) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export async function writeResumeDoc(
  bucket: R2Bucket,
  handle: string,
  doc: ResumeDoc,
): Promise<ResumeDoc> {
  const next: ResumeDoc = {
    ...doc,
    meta: {
      ...doc.meta,
      version: (doc.meta.version ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    },
  };
  await bucket.put(resumeDocKey(handle), JSON.stringify(next, null, 2), {
    httpMetadata: { contentType: "application/json" },
  });
  return next;
}

/**
 * Deep-merge a Partial<ResumeDoc> patch onto the existing doc, validate
 * against the schema, and write back. Arrays are REPLACED (not merged
 * per-index) — callers pass the full new array when editing list
 * sections.
 */
export async function patchResumeDoc(
  bucket: R2Bucket,
  handle: string,
  patch: unknown,
): Promise<
  | { ok: true; doc: ResumeDoc }
  | { ok: false; error: string; issues?: unknown }
> {
  const current = await loadResumeDoc(bucket, handle);
  if (!current) return { ok: false, error: "no_doc" };

  const merged = deepMerge(
    current as unknown as Record<string, unknown>,
    patch as Record<string, unknown>,
  );

  const parsed = ResumeDocSchema.safeParse(merged);
  if (!parsed.success) {
    return { ok: false, error: "invalid_patch", issues: parsed.error.issues };
  }

  const written = await writeResumeDoc(bucket, handle, parsed.data);
  return { ok: true, doc: written };
}

function deepMerge(
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
    if (v && typeof v === "object") {
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
