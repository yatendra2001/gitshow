/**
 * Shared prompt-assembly helpers.
 *
 * Every agent needs to feed the LLM a slice of the scan state. These
 * helpers keep the rendered context identical across agents so downstream
 * models don't see subtly different framings of the same facts.
 *
 * Workers (that go do research) want the FULL discover block including
 * the investigation angles. Synthesis agents (hook, numbers, disclosure,
 * shipped, timeline, copy-editor, critic) only need the summary — they
 * already have the workers' claims as their research input.
 */

import type { DiscoverOutput, WorkerOutput } from "../schemas.js";

/**
 * Full discover block: primary_shape + distinctive paragraph +
 * investigation_angles. Use in workers that will actively investigate.
 */
export function renderDiscoverHeader(d: DiscoverOutput): string {
  const lines = [
    `## Discover summary`,
    `Primary shape: ${d.primary_shape}`,
    ``,
    d.distinctive_paragraph,
    ``,
    `## Investigation angles`,
  ];
  for (const a of d.investigation_angles) lines.push(`- ${a}`);
  lines.push(``);
  return lines.join("\n");
}

/**
 * Short discover block: primary_shape + distinctive paragraph only.
 * Use in synthesis agents that work over the workers' claims.
 */
export function renderDiscoverSummary(d: DiscoverOutput): string {
  return [
    `## Discover summary`,
    `Primary shape: ${d.primary_shape}`,
    ``,
    d.distinctive_paragraph,
    ``,
  ].join("\n");
}

/**
 * Flat list of worker claims. Each claim line:
 *   - "<text>" — [evidence_id, evidence_id, ...]
 * Omits workers that returned 0 claims. Customize the heading per use.
 */
export function renderWorkerClaims(
  workers: WorkerOutput[],
  heading = "## Worker claims (with evidence_ids)",
): string {
  const lines = [heading];
  for (const w of workers) {
    if (w.claims.length === 0) continue;
    lines.push(`### ${w.worker}`);
    for (const c of w.claims) {
      lines.push(`- "${c.text}" — [${c.evidence_ids.join(", ")}]`);
    }
  }
  return lines.join("\n");
}

/**
 * Hard-requirement block for workers that generate claims.
 * Every claim they emit MUST pass these rules. The denominator rule
 * closes the "27-engineer org cited without evidence anchor" gap —
 * denominators must be traceable to a specific artifact.
 */
export const CLAIM_RULES_BLOCK = `
## Claim rules (hard requirements)

- Every claim MUST have >=1 evidence_id pointing to an artifact in the pre-fetched table (the ids you see in parentheses below) or to an artifact you create via tool calls.
- Claims must be SPECIFIC (real numbers, real names, real dates). "Ships fast" is not a claim; "builds a production-ready Flutter app in 48 hours, done 3 times" is a claim.
- Claims must be SURPRISING. If the developer could have written it themselves on LinkedIn, don't write it.
- Claims must be EARNED. If the data doesn't clearly support it, cut it.
- If you can't find a claim in your area that meets these bars, submit fewer claims or submit 0 claims with a note. Don't invent.
- Claims that need web verification should use browse_web or search_github — don't guess at numbers you can't cite.

## Denominator rule (hard)

Any claim that cites a DENOMINATOR or TOTAL — "#1 of N contributors", "X of Y commits", "star count", "download count", "team size" — MUST include the artifact that proves that denominator in its evidence_ids.
- The "N contributors" denominator: cite the \`inventory:<repo>\` artifact (its metadata carries \`total_contributors\`).
- A star-count claim: cite the \`repo:\` artifact whose metadata carries \`stars\`.
- An external-adoption number (npm downloads, app-store ranks, Product Hunt votes): cite the \`web:\` artifact you browsed.
If you can't locate the artifact that anchors the denominator, rewrite the claim to use only numbers you can back.
`;
