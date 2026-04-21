/**
 * education-agent — produces the Education section.
 *
 * Source priority:
 *   1. Intake answers (user-provided) — primary. Education is almost
 *      never reliably inferable from GitHub alone.
 *   2. LinkedIn scrape (same pipeline as work-agent).
 *   3. Bio-level hints in GitHub profile README.
 *
 * ## Current status
 *
 * Stub — returns empty array until intake flow is shipped.
 */

import type { ScanSession, Artifact } from "../../schemas.js";
import type { SessionUsage } from "../../session.js";
import type { GitHubData } from "../../types.js";

export interface EducationEntry {
  id: string;
  school: string;
  degree: string;
  start: string;
  end: string;
  logoUrl?: string;
  href?: string;
}

export interface EducationAgentInput {
  session: ScanSession;
  usage: SessionUsage;
  github: GitHubData;
  artifacts: Record<string, Artifact>;
  onProgress?: (text: string) => void;
}

/**
 * TODO (next commit): implement after intake flow. Until then, empty.
 */
export async function runEducationAgent(
  input: EducationAgentInput,
): Promise<EducationEntry[]> {
  const log = input.onProgress ?? (() => {});
  log(`\n[education] STUB — returning empty education[] until intake flow is implemented\n`);
  return [];
}
