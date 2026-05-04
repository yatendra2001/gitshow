/**
 * Work-experience description rewrite — single Sonnet call that turns
 * LinkedIn-imported bullet-list dumps into 2-3 sentence prose.
 *
 * Why: ProxyCurl (and any other LinkedIn extractor) returns the user's
 * job descriptions verbatim from the profile. Those are typically:
 *   • Bullet • Bullet • Bullet • Bullet
 *   • Bullet
 * with stale verb tense ("Cut data retrieval time…", "Boosted user
 * interaction by 331%…"). Looks like a CV, not a portfolio. We rewrite
 * each into a short prose paragraph that reads like the user talking
 * about their work.
 *
 * Mutates `kg.edges[*].attrs.description` in place for every WORKED_AT
 * edge that has a substantive description (> 200 chars). Short
 * descriptions ("building X") are left alone.
 *
 * Single batched call for the whole work history (typical ≤ 12
 * entries, fits in one Sonnet prompt easily). Cost: ~$0.05/scan.
 */

import * as z from "zod/v4";

import { runAgentWithSubmit, type AgentEventEmit } from "../../agents/base.js";
import { modelForRole } from "@gitshow/shared/models";
import type { KnowledgeGraph } from "@gitshow/shared/kg";
import type { ScanSession } from "../../schemas.js";
import type { SessionUsage } from "../../session.js";
import type { ScanTrace } from "../observability/trace.js";

const REWRITE_MIN_CHARS = 200;
const REWRITE_TIMEOUT_MS = 90_000;
const REWRITE_MAX_ITERATIONS = 8;

const RewriteSchema = z.object({
  rewrites: z
    .array(
      z.object({
        id: z.string().min(1),
        description: z.string().min(15).max(280),
      }),
    )
    .max(50),
});

const SYSTEM_PROMPT = `You rewrite work-experience descriptions on a developer's portfolio.
Input is a list of entries (id, company, title, original description —
usually a LinkedIn bullet-list dump in stale third-person verbs).

Output for each: ONE short sentence per role. Two sentences MAXIMUM,
and only if there is a real metric worth keeping that doesn't fit in one.

The vibe is terse and concrete. Each role should sound a bit different
— don't make every entry start the same way.

Examples (variety on purpose):

  "Building a video-first podcast hosting platform."
  "Created a hands-on platform to learn Flutter for free."
  "Built FlutterGPT, an open-source copilot for Flutter developers."
  "Shipped MVP features across web and mobile using Firebase."
  "Built a Node.js + MongoDB POC that the team later adopted."
  "Cut data retrieval time from 45s to 3s on the search path."
  "Led migration off Heroku, reducing infra spend ~40%."
  "Improved onboarding and CI/CD efficiency across two repos."

Rules:

- 1 sentence (2 only if there's a real number worth keeping).
- Action-verb start: "Building...", "Built...", "Shipped...", "Led...",
  "Created...", "Cut...". Present tense for current role, past tense
  for past roles.
- Plain English. No corporate-speak ("responsible for", "key contributor",
  "spearheaded"), no hedge words, no repeated job titles.
- KEEP concrete numbers when present (331%, 45s→3s, 1.5k users, 10k+ stars).
  DROP vague claims ("improved efficiency", "boosted engagement", "optimized performance").
- Don't repeat the title or company (those are rendered separately above).
- No first-person filler ("I had the opportunity to...", "I was lucky enough to...").
- No em-dashes — use commas or periods.
- Stay strictly faithful to the original. Don't invent companies, dates,
  products, users, or metrics not in the input.

If the original is already a clean 1-sentence description, return it
nearly verbatim — only fix obvious awkwardness.

Output: call submit_rewrites once with rewrites: [{id, description}].
Include EVERY entry from the input, in the same order. Do not skip any id.`;

export interface WorkRewriteInput {
  kg: KnowledgeGraph;
  session: ScanSession;
  usage: SessionUsage;
  trace?: ScanTrace;
  onProgress?: (text: string) => void;
  emit?: AgentEventEmit;
}

export interface WorkRewriteOutput {
  /** Number of WORKED_AT edges whose description was rewritten. */
  rewritten: number;
  /** Number of WORKED_AT edges that were skipped (short / no desc). */
  skipped: number;
  durationMs: number;
}

export async function rewriteWorkDescriptions(
  input: WorkRewriteInput,
): Promise<WorkRewriteOutput> {
  const { kg, session, usage, trace, onProgress, emit } = input;
  const t0 = Date.now();

  const workEdges = kg.edges.filter((e) => e.type === "WORKED_AT");
  const companies = kg.entities.companies;

  // Pull candidates: only edges with substantive descriptions get
  // rewritten. Short ones ("building X") read fine as-is.
  interface Candidate {
    id: string;
    company: string;
    title: string;
    description: string;
  }
  const candidates: Candidate[] = [];
  for (const e of workEdges) {
    const desc = String(e.attrs.description ?? "").trim();
    if (desc.length < REWRITE_MIN_CHARS) continue;
    const company = companies.find((c) => c.id === e.to);
    candidates.push({
      id: e.id,
      company: company?.canonicalName ?? "(unknown)",
      title: String(e.attrs.role ?? ""),
      description: desc,
    });
  }

  if (candidates.length === 0) {
    trace?.note(
      "work-rewrite:skipped",
      "no work descriptions long enough to rewrite",
      { workEdges: workEdges.length },
    );
    return { rewritten: 0, skipped: workEdges.length, durationMs: Date.now() - t0 };
  }

  const userInput = `## Work entries (${candidates.length} to rewrite)

${JSON.stringify(candidates, null, 2)}

---
Rewrite every entry per the rules. Submit via submit_rewrites with
the same ids. Preserve order.`;

  let rewrites: { id: string; description: string }[] = [];
  try {
    const res = await runAgentWithSubmit({
      model: modelForRole("section"),
      systemPrompt: SYSTEM_PROMPT,
      input: userInput,
      submitToolName: "submit_rewrites",
      submitToolDescription:
        "Submit the rewritten descriptions for every input entry. Call exactly once.",
      submitSchema: RewriteSchema,
      reasoning: { effort: "low" },
      timeoutMs: REWRITE_TIMEOUT_MS,
      maxIterations: REWRITE_MAX_ITERATIONS,
      session,
      usage,
      onProgress,
      trace,
      emit,
      label: "render:work-rewrite",
    });
    rewrites = res.result.rewrites;
  } catch (err) {
    trace?.note(
      "work-rewrite:error",
      `LLM rewrite failed; keeping original descriptions: ${(err as Error).message.slice(0, 160)}`,
    );
    return { rewritten: 0, skipped: workEdges.length, durationMs: Date.now() - t0 };
  }

  // Apply back to the KG. Only overwrite edges we got rewrites for —
  // any missing ids keep their original description.
  const byId = new Map(rewrites.map((r) => [r.id, r.description.trim()]));
  let rewritten = 0;
  for (const e of workEdges) {
    const next = byId.get(e.id);
    if (!next) continue;
    e.attrs.description = next;
    rewritten += 1;
  }

  const skipped = workEdges.length - rewritten;
  trace?.note(
    "work-rewrite:summary",
    `rewrote ${rewritten} of ${workEdges.length} WORKED_AT descriptions`,
    { rewritten, skipped, totalEdges: workEdges.length, candidates: candidates.length },
  );
  return { rewritten, skipped, durationMs: Date.now() - t0 };
}
