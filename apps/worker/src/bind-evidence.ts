/**
 * Evidence binder — validates every claim resolves to an artifact.
 *
 * Rules:
 *   - A claim with 0 evidence_ids is invalid (but the Zod schema should
 *     have caught this earlier; we double-check).
 *   - An evidence_id that does NOT resolve to an artifact is a *soft*
 *     violation. The claim is flagged but not dropped; the critic gets
 *     to decide if it stays.
 *   - Optionally, we can drop bad claims outright if `strict` is true.
 *
 * Returns a report the orchestrator uses to decide whether to regenerate.
 */

import type { Profile } from "./schemas.js";

export interface BindReport {
  claims_total: number;
  claims_ok: number;
  claims_missing_evidence: string[];
  claims_with_orphan_refs: Array<{ claim_id: string; orphan_ids: string[] }>;
  orphan_evidence_ids: string[];
}

export function bindEvidence(profile: Profile): BindReport {
  const artifactIds = new Set(Object.keys(profile.artifacts));
  const claims_missing_evidence: string[] = [];
  const claims_with_orphan_refs: Array<{ claim_id: string; orphan_ids: string[] }> = [];
  const orphan_evidence_ids = new Set<string>();

  let ok = 0;
  for (const c of profile.claims) {
    if (c.evidence_ids.length === 0) {
      claims_missing_evidence.push(c.id);
      continue;
    }
    const orphans = c.evidence_ids.filter((id) => !artifactIds.has(id));
    if (orphans.length > 0) {
      claims_with_orphan_refs.push({ claim_id: c.id, orphan_ids: orphans });
      for (const o of orphans) orphan_evidence_ids.add(o);
    } else {
      ok += 1;
    }
  }

  return {
    claims_total: profile.claims.length,
    claims_ok: ok,
    claims_missing_evidence,
    claims_with_orphan_refs,
    orphan_evidence_ids: [...orphan_evidence_ids],
  };
}

/** Pretty-print a report for the CLI. */
export function formatBindReport(r: BindReport): string {
  const lines: string[] = [];
  lines.push(
    `evidence: ${r.claims_ok}/${r.claims_total} claims have fully resolved evidence`,
  );
  if (r.claims_missing_evidence.length > 0) {
    lines.push(
      `  MISSING: ${r.claims_missing_evidence.length} claims with no evidence — ${r.claims_missing_evidence.join(", ")}`,
    );
  }
  if (r.claims_with_orphan_refs.length > 0) {
    lines.push(
      `  ORPHAN: ${r.claims_with_orphan_refs.length} claims reference unknown artifact ids:`,
    );
    for (const o of r.claims_with_orphan_refs.slice(0, 10)) {
      lines.push(`    - ${o.claim_id} → ${o.orphan_ids.join(", ")}`);
    }
  }
  return lines.join("\n");
}
