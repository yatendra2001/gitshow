/**
 * work-agent — produces the Work Experience accordion.
 *
 * Source priority:
 *   1. Intake answers (user-confirmed) — highest trust.
 *   2. LinkedIn scrape via Jina Reader — when available.
 *   3. Commit-email domains + team-repo signals from normalize.ts —
 *      used for AI-inferred "likely employer" entries confirmed through
 *      intake Q&A.
 *   4. Clearbit logo lookup per company; initials-on-color fallback.
 *
 * ## Current status
 *
 * Stub — this module defines the output schema and signature. Without
 * intake / LinkedIn plumbing the agent today produces an empty array
 * (the portfolio renders a stub-less work section). Next commit wires:
 *   - Jina Reader on LinkedIn URL → extract employment blocks
 *   - Optional paid scraper fallback (Piloterr)
 *   - Intake session ingestion (pending intake flow in webapp)
 *   - Clearbit logo + initial fallback utility
 */

import * as z from "zod/v4";
import type { ScanSession, Artifact } from "../../schemas.js";
import type { SessionUsage } from "../../session.js";
import type { GitHubData } from "../../types.js";

export const WorkEntrySchema = z.object({
  id: z.string(),
  company: z.string().max(120),
  title: z.string().max(120),
  start: z.string().max(40),
  end: z.string().max(40),
  location: z.string().max(120).optional(),
  logoUrl: z.string().url().optional(),
  description: z.string().max(2000),
  href: z.string().url().optional(),
  badges: z.array(z.string().max(40)).default([]),
});
export type WorkEntry = z.infer<typeof WorkEntrySchema>;

export const WorkAgentOutputSchema = z.object({
  work: z.array(WorkEntrySchema).max(30),
});
export type WorkAgentOutput = z.infer<typeof WorkAgentOutputSchema>;

export interface WorkAgentInput {
  session: ScanSession;
  usage: SessionUsage;
  github: GitHubData;
  artifacts: Record<string, Artifact>;
  onProgress?: (text: string) => void;
}

/**
 * TODO (next commit): implement the full agent with LinkedIn + intake
 * reconciliation. See module docstring for source priority.
 */
export async function runWorkAgent(
  input: WorkAgentInput,
): Promise<WorkEntry[]> {
  const log = input.onProgress ?? (() => {});
  log(`\n[work] STUB — returning empty work[] until LinkedIn + intake agents are implemented\n`);
  return [];
}
