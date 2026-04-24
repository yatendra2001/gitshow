/**
 * Stable ID + slug derivation for KG entities. Deterministic across
 * scans so the same `Company { name: "Stripe" }` always lands on
 * `co:stripe`, regardless of which fetcher produced it.
 */

export function slug(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function personId(handle: string): string {
  return `person:${slug(handle)}`;
}

export function companyId(opts: { name?: string; domain?: string }): string {
  if (opts.domain) return `co:${slug(opts.domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0])}`;
  if (opts.name) return `co:${slug(opts.name)}`;
  return `co:${slug(String(Math.random()))}`;
}

export function schoolId(opts: { name?: string; domain?: string }): string {
  if (opts.domain) return `sc:${slug(opts.domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0])}`;
  if (opts.name) return `sc:${slug(opts.name)}`;
  return `sc:${slug(String(Math.random()))}`;
}

export function projectId(opts: { repoFullName?: string; title?: string }): string {
  if (opts.repoFullName) return `proj:${slug(opts.repoFullName.replace("/", "-"))}`;
  if (opts.title) return `proj:${slug(opts.title)}`;
  return `proj:${slug(String(Math.random()))}`;
}

export function repositoryId(fullName: string): string {
  return `repo:${slug(fullName.replace("/", "-"))}`;
}

export function skillId(canonical: string): string {
  return `skill:${slug(canonical)}`;
}

export function roleId(companyEntityId: string, title: string): string {
  return `role:${companyEntityId.replace(/^co:/, "")}:${slug(title)}`;
}

export function publicationId(opts: { url?: string; title?: string; doi?: string }): string {
  if (opts.doi) return `pub:doi-${slug(opts.doi)}`;
  if (opts.url) return `pub:url-${slug(opts.url)}`;
  if (opts.title) return `pub:${slug(opts.title)}`;
  return `pub:${slug(String(Math.random()))}`;
}

export function achievementId(opts: { title: string; date?: string }): string {
  return `ach:${slug(opts.title)}${opts.date ? `:${opts.date.slice(0, 10)}` : ""}`;
}

export function eventId(opts: { name: string; date?: string }): string {
  return `evt:${slug(opts.name)}${opts.date ? `:${opts.date.slice(0, 10)}` : ""}`;
}

export function mediaAssetId(opts: { ownerId: string; kind: string }): string {
  return `media:${opts.ownerId}:${opts.kind}`;
}

export function edgeId(opts: { type: string; from: string; to: string; suffix?: string }): string {
  const s = `${opts.type}:${opts.from}->${opts.to}${opts.suffix ? `:${opts.suffix}` : ""}`;
  return `edge:${slug(s).slice(0, 80)}`;
}
