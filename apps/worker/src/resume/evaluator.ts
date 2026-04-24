/**
 * Evaluator-optimizer — the quality gate between section agents and persist.
 *
 * This is the Anthropic playbook's evaluator-optimizer pattern, scoped
 * to deterministic checks. The goal: catch obviously thin output
 * (empty work when LinkedIn exists, skills < 8, projects out of range)
 * BEFORE it reaches the user.
 *
 * Deterministic-only: no LLM calls here. Cheaper, faster, and the
 * failure modes it catches are structural, not semantic. If we want
 * semantic critiques ("this summary reads like a LinkedIn bio, rewrite
 * it") later, that's an Opus pass layered on top.
 *
 * The evaluator emits a list of `EvaluatorIssue`s with a remediation
 * hint (which section to rerun). The pipeline uses that to optionally
 * re-run individual section agents up to `maxRetries` times.
 */

import type { Resume } from "@gitshow/shared/resume";
import type { EvidenceBag } from "./research/dev-evidence.js";

export type EvaluatorSection =
  | "work"
  | "education"
  | "skills"
  | "projects"
  | "buildLog"
  | "blog"
  | "person";

export interface EvaluatorIssue {
  section: EvaluatorSection;
  severity: "error" | "warn";
  /** Short, actionable. Will be logged and surfaced to the next agent run. */
  message: string;
  /** Which agent to rerun to fix this (if anything). `null` = informational. */
  rerun: EvaluatorSection | null;
}

export interface EvaluatorInput {
  resume: Resume;
  /** User provided a LinkedIn URL (regardless of whether fetch succeeded). */
  hasLinkedIn: boolean;
  /** User provided intake answers with specific company/school mentions. */
  hasIntakeSignal: boolean;
  evidence?: EvidenceBag;
}

export interface EvaluatorReport {
  pass: boolean;
  issues: EvaluatorIssue[];
  /** Unique sections that need re-running to fix blocking issues. */
  sectionsToRerun: EvaluatorSection[];
}

const MIN_SKILLS = 8;
const MIN_PROJECTS = 3;
const MAX_PROJECTS = 6;
const MIN_WORK_DESCRIPTION_CHARS = 60;
const MIN_SUMMARY_LINKS = 2;

export function evaluateResume(input: EvaluatorInput): EvaluatorReport {
  const { resume, hasLinkedIn, hasIntakeSignal, evidence } = input;
  const issues: EvaluatorIssue[] = [];
  const hasEvidenceAboutEmployment =
    !!evidence &&
    evidence.cards.some(
      (c) => c.confidence === "high" && /\b(engineer|founder|cto|ceo|intern|worked|works at|joined)\b/i.test(c.summary),
    );

  // ─── work ─────────────────────────────────────────────────────────
  if (resume.work.length === 0) {
    if (hasLinkedIn || hasIntakeSignal || hasEvidenceAboutEmployment) {
      issues.push({
        section: "work",
        severity: "error",
        message:
          "work[] is empty but the scan has a LinkedIn URL / intake signal / employment-adjacent evidence. The agent should produce at least one entry.",
        rerun: "work",
      });
    }
  } else {
    // Every emitted entry should have a substantive description.
    for (const w of resume.work) {
      if (!w.description || w.description.length < MIN_WORK_DESCRIPTION_CHARS) {
        issues.push({
          section: "work",
          severity: "warn",
          message: `work entry "${w.company}" has description shorter than ${MIN_WORK_DESCRIPTION_CHARS} chars — rewrite with 1-3 specific sentences.`,
          rerun: "work",
        });
        break; // one warn per section is enough
      }
    }
  }

  // ─── education ────────────────────────────────────────────────────
  if (resume.education.length === 0) {
    if (hasLinkedIn || hasIntakeSignal) {
      issues.push({
        section: "education",
        severity: "error",
        message:
          "education[] is empty but a LinkedIn URL / intake signal is present. At least one entry expected.",
        rerun: "education",
      });
    }
  }

  // ─── skills ───────────────────────────────────────────────────────
  if (resume.skills.length < MIN_SKILLS) {
    issues.push({
      section: "skills",
      severity: "error",
      message: `skills has ${resume.skills.length} entries — below the ${MIN_SKILLS} minimum. Widen selection from the ledger.`,
      rerun: "skills",
    });
  }

  // ─── projects ─────────────────────────────────────────────────────
  if (resume.projects.length < MIN_PROJECTS) {
    issues.push({
      section: "projects",
      severity: "error",
      message: `projects has ${resume.projects.length} entries — below ${MIN_PROJECTS} minimum.`,
      rerun: "projects",
    });
  } else if (resume.projects.length > MAX_PROJECTS) {
    // Shouldn't happen once pick-featured cap is enforced, but belt-and-braces.
    issues.push({
      section: "projects",
      severity: "warn",
      message: `projects has ${resume.projects.length} entries — above ${MAX_PROJECTS}. Trim to top-${MAX_PROJECTS}.`,
      rerun: null,
    });
  }

  // ─── buildLog ─────────────────────────────────────────────────────
  if (resume.buildLog.length < 5) {
    issues.push({
      section: "buildLog",
      severity: "warn",
      message: `buildLog has ${resume.buildLog.length} entries — thin timeline signals "hasn't shipped much".`,
      rerun: null,
    });
  }

  // ─── person.summary has cross-section links ───────────────────────
  const summary = resume.person?.summary ?? "";
  const linkCount = (summary.match(/\(\/#(education|work|projects|skills|hackathons)\)/g) ?? []).length;
  if (linkCount < MIN_SUMMARY_LINKS && summary.length > 0) {
    issues.push({
      section: "person",
      severity: "warn",
      message: `person.summary has ${linkCount} cross-section links — goal is ${MIN_SUMMARY_LINKS}+ (e.g. [intern at big tech](/#work)).`,
      rerun: "person",
    });
  }

  const errors = issues.filter((i) => i.severity === "error");
  const rerunSet = new Set<EvaluatorSection>();
  for (const i of issues) if (i.rerun) rerunSet.add(i.rerun);

  return {
    pass: errors.length === 0,
    issues,
    sectionsToRerun: Array.from(rerunSet),
  };
}

/**
 * Render an EvaluatorReport as a markdown block we can feed back into
 * a re-running agent as extra guidance ("last attempt had these issues:").
 */
export function formatReportForAgent(report: EvaluatorReport): string {
  if (report.issues.length === 0) return "";
  const lines = ["## Evaluator feedback from the previous attempt"];
  for (const i of report.issues) {
    lines.push(`- [${i.severity}] ${i.section}: ${i.message}`);
  }
  lines.push("");
  lines.push("Address the above — especially any `error` items — in this attempt.");
  return lines.join("\n");
}
