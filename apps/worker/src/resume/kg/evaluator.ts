/**
 * KG Evaluator — runs against the KnowledgeGraph (not the Resume).
 *
 * Blocking rules retry the smallest set of fetchers that could fix
 * them; the retry loop is capped at one iteration in the pipeline.
 * Warning rules log and ship.
 */

import type { KnowledgeGraph } from "@gitshow/shared/kg";
import type { ScanTrace } from "../observability/trace.js";

export type IssueSeverity = "error" | "warn" | "note";

export interface KgIssue {
  section: string;
  severity: IssueSeverity;
  message: string;
}

export interface KgEvaluationReport {
  pass: boolean;
  blockingErrors: number;
  warnings: number;
  issues: KgIssue[];
}

export interface EvaluateKgInput {
  kg: KnowledgeGraph;
  hasLinkedIn: boolean;
  hasPersonalSite: boolean;
  trace?: ScanTrace;
}

const NOISE_KINDS = new Set([
  "contribution-mirror",
  "dotfiles-config",
  "empty-or-trivial",
  "coursework",
  "tutorial-follow",
  "template-clone",
]);

export function evaluateKg(input: EvaluateKgInput): KgEvaluationReport {
  const issues: KgIssue[] = [];
  const { kg, hasLinkedIn, hasPersonalSite } = input;

  // BLOCKING: 0 Person
  if (kg.entities.persons.length === 0) {
    issues.push({
      section: "person",
      severity: "error",
      message: "No Person node — pipeline produced an empty graph",
    });
  }

  // BLOCKING: featured contains noise-kind
  const noisyFeatured = kg.entities.projects.filter(
    (p) => p.shouldFeature && NOISE_KINDS.has(p.kind),
  );
  for (const p of noisyFeatured) {
    issues.push({
      section: "projects",
      severity: "error",
      message: `Featured project "${p.title}" classified as ${p.kind} — judge override`,
    });
  }

  // BLOCKING: LinkedIn provided but 0 WORKED_AT after the chain succeeded.
  // The fetcher chain (ProxyCurl → TinyFish Agent → Gemini grounded) is
  // expected to always return SOMETHING when a LinkedIn URL is supplied;
  // a zero-fact result means a real failure worth flagging.
  const workedAt = kg.edges.filter((e) => e.type === "WORKED_AT");
  if (hasLinkedIn && workedAt.length === 0) {
    issues.push({
      section: "work",
      severity: "error",
      message: "LinkedIn URL provided but produced 0 WORKED_AT edges",
    });
  }

  // BLOCKING: any edge with 0 sources is a fetcher bug.
  for (const e of kg.edges) {
    if (e.sources.length === 0) {
      issues.push({
        section: "edges",
        severity: "error",
        message: `Edge ${e.id} has 0 sources — fetcher bug`,
      });
    }
  }

  // WARNING: personal site set, fetcher returned 0 facts.
  // We can't know "0 facts from personal-site" without scanning sources; the
  // pipeline emits this signal directly (see fetcher.facts trace events). Here
  // we approximate: if hasPersonalSite is set but the Person node has no bio.
  if (hasPersonalSite && !kg.entities.persons[0]?.bio) {
    issues.push({
      section: "personal-site",
      severity: "warn",
      message: "Personal site provided but no narrative captured — site is probably JS-heavy",
    });
  }

  // WARNING: < 3 featured projects.
  const featuredCount = kg.entities.projects.filter((p) => p.shouldFeature).length;
  if (featuredCount < 3) {
    issues.push({
      section: "projects",
      severity: "warn",
      message: `Only ${featuredCount} featured project(s) — thin work surface`,
    });
  }

  // NOTE: every WORKED_AT has an associated Role node.
  for (const e of workedAt) {
    const roleTitle = (e.attrs?.role ?? "") as string;
    const cId = e.to;
    const expected = kg.entities.roles.find(
      (r) => r.normalizedTitle === slugify(roleTitle) && cId.startsWith("co:"),
    );
    if (!expected) {
      issues.push({
        section: "roles",
        severity: "note",
        message: `WORKED_AT edge ${e.id} has no matching Role node`,
      });
    }
  }

  // NOTE: featured project with empty purpose / no tags.
  for (const p of kg.entities.projects) {
    if (!p.shouldFeature) continue;
    if (!p.purpose) {
      issues.push({
        section: "projects",
        severity: "note",
        message: `Featured project ${p.id} missing purpose`,
      });
    }
    if ((p.tags ?? []).length < 3) {
      issues.push({
        section: "projects",
        severity: "note",
        message: `Featured project ${p.id} has fewer than 3 tags`,
      });
    }
  }

  const blockingErrors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warn").length;

  input.trace?.kgEvaluator({
    label: "kg.evaluator",
    blockingErrors,
    warnings,
    details: issues.map((i) => ({
      section: i.section,
      severity: i.severity,
      message: i.message,
    })),
  });

  return {
    pass: blockingErrors === 0,
    blockingErrors,
    warnings,
    issues,
  };
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
