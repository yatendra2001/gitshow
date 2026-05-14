/**
 * Tailored resume I/O — server-side read/write for JD-tailored resume
 * variants stored in R2.
 *
 * Layout in R2:
 *   resumes/{handle}/tailored/index.json    — light index for the list pane
 *   resumes/{handle}/tailored/{id}.json     — one tailored variant per id
 *
 * The index is the source of truth for the list view; the per-id blob
 * holds the full doc + the original JD text. We keep them in sync on
 * every write/delete. If the index ever drifts (e.g. a partial write
 * fails) the caller can rebuild it from a `list()` over the prefix —
 * not done here because R2 list cost is non-trivial; the index is
 * cheap to keep correct.
 */

import {
  TailoredResumeIndexSchema,
  TailoredResumeSchema,
  type TailoredResume,
  type TailoredResumeIndex,
  type TailoredResumeMeta,
} from "@gitshow/shared/tailored-resume";
import { ResumeDocSchema } from "@gitshow/shared/resume-doc";

const MAX_TAILORED_PER_USER = 50;

export function tailoredIndexKey(handle: string): string {
  return `resumes/${handle.toLowerCase()}/tailored/index.json`;
}

export function tailoredResumeKey(handle: string, id: string): string {
  return `resumes/${handle.toLowerCase()}/tailored/${id}.json`;
}

/**
 * Load the tailored-resume index. Missing index → returns an empty
 * index rather than throwing — first-time users have no tailored
 * resumes yet.
 */
export async function loadTailoredIndex(
  bucket: R2Bucket | undefined,
  handle: string,
): Promise<TailoredResumeIndex> {
  const empty: TailoredResumeIndex = { schemaVersion: 1, items: [] };
  if (!bucket) return empty;
  try {
    const obj = await bucket.get(tailoredIndexKey(handle));
    if (!obj) return empty;
    const text = await obj.text();
    const raw: unknown = JSON.parse(text);
    const parsed = TailoredResumeIndexSchema.safeParse(raw);
    if (!parsed.success) return empty;
    return parsed.data;
  } catch {
    return empty;
  }
}

export async function loadTailoredResume(
  bucket: R2Bucket | undefined,
  handle: string,
  id: string,
): Promise<TailoredResume | null> {
  if (!bucket) return null;
  try {
    const obj = await bucket.get(tailoredResumeKey(handle, id));
    if (!obj) return null;
    const text = await obj.text();
    const raw: unknown = JSON.parse(text);
    const parsed = TailoredResumeSchema.safeParse(raw);
    if (!parsed.success) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

/**
 * Persist a tailored resume. Bumps `meta.updatedAt`, writes the blob,
 * and inserts/updates the index entry. Idempotent — repeat writes with
 * the same id overwrite cleanly and don't duplicate index rows.
 *
 * Enforces a per-user cap (`MAX_TAILORED_PER_USER`) — when the user
 * is at the cap and adds a new one, the oldest is dropped. The user
 * sees the most recent 50 in the list; older variants are deleted
 * from R2 to keep cost bounded.
 */
export async function writeTailoredResume(
  bucket: R2Bucket,
  handle: string,
  tailored: TailoredResume,
): Promise<TailoredResume> {
  const now = new Date().toISOString();
  const next: TailoredResume = {
    ...tailored,
    meta: { ...tailored.meta, updatedAt: now },
  };

  await bucket.put(
    tailoredResumeKey(handle, next.meta.id),
    JSON.stringify(next, null, 2),
    { httpMetadata: { contentType: "application/json" } },
  );

  const index = await loadTailoredIndex(bucket, handle);
  const filtered = index.items.filter((it) => it.id !== next.meta.id);
  const updated: TailoredResumeMeta[] = [next.meta, ...filtered]
    // Sort newest first by createdAt; new entries already are.
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  // Cap retained variants. Anything past the cap gets purged from R2
  // as well — no orphaned blobs.
  const retained = updated.slice(0, MAX_TAILORED_PER_USER);
  const dropped = updated.slice(MAX_TAILORED_PER_USER);
  await Promise.all(
    dropped.map((it) =>
      bucket.delete(tailoredResumeKey(handle, it.id)).catch(() => {}),
    ),
  );

  await bucket.put(
    tailoredIndexKey(handle),
    JSON.stringify({ schemaVersion: 1, items: retained }, null, 2),
    { httpMetadata: { contentType: "application/json" } },
  );

  return next;
}

/**
 * Delete a tailored resume. Removes both the blob and its index entry.
 * Idempotent — missing entries are not an error.
 */
export async function deleteTailoredResume(
  bucket: R2Bucket,
  handle: string,
  id: string,
): Promise<{ ok: boolean }> {
  await bucket.delete(tailoredResumeKey(handle, id)).catch(() => {});
  const index = await loadTailoredIndex(bucket, handle);
  const next = index.items.filter((it) => it.id !== id);
  if (next.length === index.items.length) return { ok: true };
  await bucket.put(
    tailoredIndexKey(handle),
    JSON.stringify({ schemaVersion: 1, items: next }, null, 2),
    { httpMetadata: { contentType: "application/json" } },
  );
  return { ok: true };
}

/**
 * Deep-merge a `Partial<ResumeDoc>` patch onto the existing tailored
 * resume's doc, validate the result, and write back. Mirrors the base
 * editor's `patchResumeDoc` shape so the editor form code can target
 * either surface with the same payload format.
 *
 * Arrays are REPLACED rather than merged per-index — callers pass the
 * full new array when editing list sections.
 */
export async function patchTailoredResume(
  bucket: R2Bucket,
  handle: string,
  id: string,
  patch: unknown,
): Promise<
  | { ok: true; tailored: TailoredResume }
  | { ok: false; error: string; issues?: unknown }
> {
  const current = await loadTailoredResume(bucket, handle, id);
  if (!current) return { ok: false, error: "not_found" };

  const mergedDoc = deepMerge(
    current.doc as unknown as Record<string, unknown>,
    patch as Record<string, unknown>,
  );

  const parsed = ResumeDocSchema.safeParse(mergedDoc);
  if (!parsed.success) {
    return { ok: false, error: "invalid_patch", issues: parsed.error.issues };
  }

  const next: TailoredResume = { ...current, doc: parsed.data };
  const written = await writeTailoredResume(bucket, handle, next);
  return { ok: true, tailored: written };
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

/**
 * Generate a stable-ish, URL-safe id for a new tailored resume. Mixes
 * a ms timestamp with a short random suffix — collisions across a
 * single user are astronomically unlikely, and the timestamp prefix
 * keeps the keys roughly sortable in R2.
 */
export function newTailoredId(): string {
  const ms = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `t_${ms}_${rand}`;
}
