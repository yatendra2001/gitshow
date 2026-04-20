/**
 * Deep-dive worker — specialized for the developer's PRIMARY WORK repos.
 *
 * "Primary work" = repos where:
 *   - multiple contributors (not solo),
 *   - user is a top contributor by commit count,
 *   - active for several months.
 *
 * Strong signal of employment. This worker digs beyond git metadata:
 * reads the actual code, maps the product and architecture, identifies
 * teammates, and characterizes the user's day-to-day role. Heaviest user
 * of the code tools (read_file, list_tree, git_log, git_show).
 */

import { runWorker, renderDiscoverHeader, CLAIM_RULES_BLOCK, type WorkerDeps } from "./base-worker.js";
import type { Artifact, WorkerOutput } from "../../schemas.js";

const DEEP_DIVE_PROMPT = `You are an employment-context investigator and code archaeologist.

The developer has one or more "primary work" repos — codebases where they've been a top contributor over months or years, alongside other engineers. These are almost certainly where they work full-time (or did during that period). The other parallel workers focus on patterns; your job is to make this profile UNDENIABLE about this specific body of work.

You have two unusual superpowers the other workers lack:
  - list_tree / read_file — inspect actual source code, not just git metadata
  - git_log / git_show   — read specific commits to see exactly what they built

For each primary-work repo (usually 1–3 at most), investigate:

1. **What the product actually is.** Read the README. If sparse, list the root directory and read a key source file. Name the product in human terms ("a X-for-Y platform," not "a TypeScript/Go codebase"). If the owning org looks like a company, try browse_web on <org-name>.com or search_web for "<org-name> company" to discover a product page.

1b. **Establish the employment relationship — mandatory.** If a primary-work repo exists (looks_like_team_repo is true), you MUST produce a claim that names WHO the developer works for. This is the single highest-value finding in the whole profile. Do this:
   - If the user provided a LinkedIn URL IN THE SOCIALS BLOCK, \`browse_web\` that exact URL. Do NOT construct a LinkedIn URL from the GitHub handle.
   - If they provided a personal site, browse it and read the role headline.
   - Browse the product domain (if the org name plausibly maps to one): \`https://<likely-product>.com\`.
   - Search the web: \`search_web "<org-name> company"\` or \`search_web "<product> CEO"\`.
   - Connect the dots using the evidence you actually have. Don't stop until you can answer: *who is the employer, what is the product, who is behind it?*
   - If after genuine effort the employer remains unconfirmed, SAY SO in a note — don't silently drop the question.
   - HARD DON'T: never fabricate an external URL. \`linkedin.com/in/<handle>\` and \`<handle>.com\` are inferences, not facts — treat them as if they don't exist unless the user explicitly provided them.

2. **Who's on the team.** Use the inventory's other_top_contributors list. Note the number of engineers and the user's rank. This is your strongest employment signal.

3. **What the user owns.** Use git_log with --author=<user> on specific subdirectories (run list_tree first to find them). Is the user the main committer on backend/services/api/infra/ui? What does that pattern reveal about their specialty?

4. **Scale + architecture.** list_tree at depth 2–3 to see the shape. Are there multiple services? Kubernetes manifests? Lambdas? Workers? Is this a monolith, a distributed system, or something in between? Quantify ("15 services," "3 microservices + 2 edge workers," etc.).

5. **Representative work — prefer SHIPPED OUTCOMES over commit counts.** Pick 1–2 SPECIFIC commits or PRs the user authored that represent a *shipped feature* or a *consequential fix*. git_show them. Describe what shipped in human terms ("built the self-serve migration flow", not "authored commit X with Y lines"). The inventory metadata exposes \`features_shipped\` and \`bugs_fixed\` counts per repo — prefer those over raw commit totals when quantifying contribution.

6. **Tenure.** First/last commit dates reveal the employment window. If it's been 18+ months of daily-cadence commits on a team repo, that's a multi-year engineering role. Say it plainly.

7. **Learning trajectory (when visible).** If the developer obviously ramped into a NEW language or domain inside the team repo (e.g. added Go to a TypeScript shop, picked up Rust), try to identify the *mechanism* from commits:
   - READMEs or comments that reference learning resources ("I followed <guide>", "based on <blog>").
   - First commits in the new language — were they scaffolded from a tutorial, copied from a docs example, or written from scratch?
   - Paired context in the commits before and after (comments like "new to X", "my first <lang>").
   - If there is NO visible evidence of the enabling mechanism (no learning-resource mentions, no external mentor), don't speculate. Say the data is silent on the mechanism.

${CLAIM_RULES_BLOCK}

Produce 3–6 claims that collectively establish: *what the developer has actually been doing with their last N years of work, and where*. Each claim must cite specific evidence_ids (commits, inventory summaries, or new web/code artifacts you create). If you create new artifacts by reading code, populate new_artifacts in the output.

Worker name: "deep-dive".`;

export async function runDeepDiveWorker(deps: WorkerDeps): Promise<WorkerOutput> {
  return runWorker({
    ...deps,
    name: "deep-dive",
    systemPrompt: DEEP_DIVE_PROMPT,
    webBudget: Number.POSITIVE_INFINITY,
    githubSearchBudget: Number.POSITIVE_INFINITY,
    includeCodeTools: true,
    buildInput: (d) => {
      const lines: string[] = [];
      lines.push(renderDiscoverHeader(d.discover));
      lines.push(`## Your focus: the developer's primary WORK repos.`);
      lines.push(``);

      // Rank all inventory artifacts by team-signal strength
      const invs = Object.keys(d.artifacts)
        .filter((id) => id.startsWith("inventory:"))
        .map((id) => d.artifacts[id])
        .filter(Boolean);

      const primaryWork = invs
        .filter((a) => {
          const m = a.metadata as Record<string, unknown>;
          return m.looks_like_team_repo === true;
        })
        .sort((a, b) => {
          const ua = Number((a.metadata as Record<string, unknown>).user_commits ?? 0);
          const ub = Number((b.metadata as Record<string, unknown>).user_commits ?? 0);
          return ub - ua;
        });

      if (primaryWork.length === 0) {
        lines.push(`### No multi-contributor repos detected.`);
        lines.push(`The developer appears to be solo across all analyzed repos. If you see evidence in the discover paragraph that contradicts this, flag it in notes and submit 0 claims.`);
        return lines.join("\n");
      }

      lines.push(`### Candidate primary-work repos (sorted by user commits)`);
      for (const a of primaryWork.slice(0, 5)) {
        const m = a.metadata as Record<string, unknown>;
        const others = Array.isArray(m.other_top_contributors)
          ? (m.other_top_contributors as Array<{ name: string; email: string; commits: number }>).slice(0, 6)
          : [];
        lines.push(
          `- [${a.id}] ${m.repo}: ${m.user_commits} / ${m.total_commits} user-commits (rank #${m.user_rank_in_repo} of ${m.total_contributors} contributors) · ${m.active_days}d active · streak ${m.longest_streak_days}d`,
        );
        lines.push(`    first commit: ${m.first_commit}   last commit: ${m.last_commit}`);
        lines.push(`    languages: ${JSON.stringify(m.languages ?? [])}`);
        if (others.length > 0) {
          lines.push(`    other top contributors:`);
          for (const c of others) {
            lines.push(`      - ${c.name} <${c.email}>  ${c.commits} commits`);
          }
        }
      }
      lines.push(``);
      lines.push(`Start with list_tree on the #1 repo. Read the README. Then decide where to dig.`);
      lines.push(`Produce 3-6 claims. Every claim must cite specific evidence — commits, inventory ids, or new artifacts you create via the tools.`);
      return lines.join("\n");
    },
  });
}
