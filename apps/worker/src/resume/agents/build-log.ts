/**
 * build-log-agent — populates the "I like building things" timeline.
 *
 * Unlike the curated `projects` list (which is deep, per-item web-researched),
 * the build log is EXHAUSTIVE: every owned, non-fork repo with meaningful
 * activity becomes a timeline row. Per-repo fidelity is intentionally low —
 * just title, a one-line description, primary language, dates, and links.
 * The point is breadth ("this person has shipped a LOT").
 *
 * Strategy:
 *   1. Filter GitHub repos to owned + non-fork + non-archived + meaningful
 *      (>= 3 commits OR any stars OR has README). This is the full candidate
 *      set, not the hero-20.
 *   2. Batch into groups of 25 so each LLM call sees a manageable ledger.
 *   3. For each batch, the LLM refines the one-line description using the
 *      repo's GitHub description + README preview, keeping it factual and
 *      specific.
 *   4. Assemble into the Resume.buildLog array, sorted by first-commit date
 *      descending.
 *
 * Cost: ~1 call per 25 repos. For a prolific user with 150 repos that's
 * 6 Sonnet calls, ~2-3 minutes wall clock. Acceptable.
 */

import * as z from "zod/v4";
import { runAgentWithSubmit } from "../../agents/base.js";
import { modelForRole } from "@gitshow/shared/models";
import type { ScanSession, Artifact } from "../../schemas.js";
import type { SessionUsage } from "../../session.js";
import type { GitHubData, RepoRef } from "../../types.js";
import { colorForLanguage } from "../language-colors.js";

const BATCH_SIZE = 25;

/**
 * One refined entry as produced by the LLM. The pipeline layer adds the
 * language color + links separately (deterministic from repo metadata —
 * we don't trust the LLM to invent URLs).
 */
export const BuildLogLLMEntrySchema = z.object({
  repo_full_name: z.string().describe("owner/name — MUST exactly match one of the input repos"),
  description: z
    .string()
    .max(300)
    .describe("One-line description. 10-40 words. Specific to the project, not generic."),
});
export type BuildLogLLMEntry = z.infer<typeof BuildLogLLMEntrySchema>;

export const BuildLogBatchOutputSchema = z.object({
  entries: z.array(BuildLogLLMEntrySchema),
});
export type BuildLogBatchOutput = z.infer<typeof BuildLogBatchOutputSchema>;

/**
 * Final per-repo entry assembled by this agent. Shape matches
 * `BuildLogEntry` in `@gitshow/shared/resume` so the assembler can pass
 * it straight through (minus id assignment).
 */
export interface BuildLogEntry {
  id: string;
  title: string;
  dates: string;
  description: string;
  primaryLanguage?: string;
  languageColor?: string;
  links: { label: string; href: string; iconKey: string }[];
}

export interface BuildLogAgentInput {
  session: ScanSession;
  usage: SessionUsage;
  github: GitHubData;
  artifacts: Record<string, Artifact>;
  onProgress?: (text: string) => void;
}

const SYSTEM_PROMPT = `You refine one-line descriptions for a developer's portfolio "I like building things" timeline.

You'll receive a batch of up to 25 repositories. For each, produce a one-line description that's:
- SPECIFIC to what the repo is. "CLI tool for converting SVG icons to React components" beats "utility library".
- FACTUAL — only use what's in the GitHub description + README preview. Do not invent users, press, or impact.
- 10-40 words. Period.
- No marketing fluff ("revolutionary", "powerful", "amazing"). No placeholder ("A small project", "experiment").

If the repo has a real README but no meaningful description, craft one from the README's first paragraph. If the repo has nothing useful (empty repo, scratch pad), fall back to a terse factual line based on the name + primary language ("Small Go utility for X" / "Web-scraping experiment in Python") — never leave blank.

Output an entries array. For EACH input repo, produce one entry. repo_full_name must exactly match the input. Call submit_build_log exactly once.`;

export async function runBuildLogAgent(
  input: BuildLogAgentInput,
): Promise<BuildLogEntry[]> {
  const candidates = selectCandidates(input.github, input.artifacts);

  if (candidates.length === 0) return [];

  const log = input.onProgress ?? (() => {});
  log(`\n[build-log] ${candidates.length} candidate repos in ${Math.ceil(candidates.length / BATCH_SIZE)} batch(es)\n`);

  const batches: Array<typeof candidates> = [];
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    batches.push(candidates.slice(i, i + BATCH_SIZE));
  }

  const refinedByFullName = new Map<string, string>();

  // Batches are sequential (not parallel) to keep cost predictable and
  // honour model rate limits. If this becomes a bottleneck we can lift
  // it to parallel later; sequential on 6 batches is ~2-3 min.
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const ledger = buildBatchLedger(batch);
    log(`[build-log] batch ${i + 1}/${batches.length} (${batch.length} repos)\n`);

    const { result } = await runAgentWithSubmit({
      model: modelForRole("bulk"),
      systemPrompt: SYSTEM_PROMPT,
      input: ledger,
      submitToolName: "submit_build_log",
      submitToolDescription:
        "Submit refined one-line descriptions — one entry per input repo. Call exactly once.",
      submitSchema: BuildLogBatchOutputSchema,
      reasoning: { effort: "low" },
      session: input.session,
      usage: input.usage,
      label: `resume:build-log:batch-${i + 1}`,
      onProgress: input.onProgress,
    });

    for (const e of result.entries) {
      refinedByFullName.set(e.repo_full_name, e.description);
    }
  }

  // Assemble final entries (deterministic post-LLM — links + dates +
  // language colors all come from source metadata, not LLM imagination).
  const entries: BuildLogEntry[] = candidates.map((repo) => {
    const description =
      refinedByFullName.get(repo.fullName) ??
      repo.description ??
      `${repo.primaryLanguage ?? "Source"} project: ${repo.name}`;
    const firstCommit = firstCommitDate(repo, input.artifacts);
    const primary = repo.primaryLanguage ?? repo.languages[0];
    const links: { label: string; href: string; iconKey: string }[] = [
      {
        label: "GitHub",
        href: `https://github.com/${repo.fullName}`,
        iconKey: "github",
      },
    ];
    return {
      id: `bl:${repo.fullName}`,
      title: repo.name,
      dates: formatDates(firstCommit, repo.pushedAt),
      description,
      primaryLanguage: primary ?? undefined,
      languageColor: colorForLanguage(primary),
      links,
    };
  });

  // Newest-first so the timeline reads like a reverse chronological feed.
  entries.sort((a, b) => b.dates.localeCompare(a.dates));

  return entries;
}

/**
 * Pick the candidate set for the build log. Rule: repos the user built
 * or co-maintained + meaningful activity. Drive-by contributor repos
 * (PRs to someone else's project) belong in the "open-source
 * contributions" framing, not "things I built" — they're surfaced via
 * PR artifacts to the person agent instead.
 */
function selectCandidates(
  github: GitHubData,
  artifacts: Record<string, Artifact>,
): RepoRef[] {
  // The timeline is still meant to be broad — this is where "has shipped
  // a LOT" reads from. But scratch repos with one commit + no README just
  // add noise. Bar = "meaningful": either someone starred it, or it has
  // a sustained commit history, or it has enough README to be a real
  // thing the dev described to someone.
  const MIN_COMMITS = 10;
  const MIN_README = 300;
  return github.ownedRepos.filter((r) => {
    const rel = r.relationship ?? "owner";
    if (rel === "contributor" || rel === "reviewer") return false;
    if (r.isFork || r.isArchived) return false;
    const commits = r.userCommitCount ?? 0;
    const stars = r.stargazerCount ?? 0;
    const meta = artifacts[`repo:${r.fullName}`]?.metadata as
      | Record<string, unknown>
      | undefined;
    const readmeChars = typeof meta?.readme_chars === "number" ? (meta.readme_chars as number) : 0;
    const hasReadme = Boolean(meta?.has_readme);
    return (
      stars > 0 ||
      commits >= MIN_COMMITS ||
      readmeChars >= MIN_README ||
      (hasReadme && commits >= 3)
    );
  });
}

function buildBatchLedger(batch: RepoRef[]): string {
  const lines: string[] = [];
  lines.push(`## Repos to refine (${batch.length})`);
  lines.push("");
  for (const r of batch) {
    lines.push(`### ${r.fullName}`);
    if (r.description) lines.push(`GitHub description: ${r.description}`);
    if (r.primaryLanguage) lines.push(`Primary language: ${r.primaryLanguage}`);
    if (r.languages && r.languages.length > 0) {
      lines.push(`Languages: ${r.languages.slice(0, 5).join(", ")}`);
    }
    if (r.stargazerCount) lines.push(`Stars: ${r.stargazerCount}`);
    // README preview attached where available — inventory captures it.
    // Keep it short; the LLM doesn't need the whole doc to write 30 words.
    lines.push("");
  }
  lines.push(`---`);
  lines.push(
    `For EACH repo above, produce one entries[] item with repo_full_name matching exactly and a refined 10-40 word description. Call submit_build_log.`,
  );
  return lines.join("\n");
}

/**
 * Best-effort first-commit date. We try in order:
 *   - inventory artifact `first_commit`
 *   - repo `createdAt`
 * Returns YYYY-MM-DD.
 */
function firstCommitDate(
  repo: RepoRef,
  artifacts: Record<string, Artifact>,
): string {
  const invId = `inventory:${repo.fullName}`;
  const m = (artifacts[invId]?.metadata as Record<string, unknown> | undefined) ?? {};
  const first = m.first_commit;
  if (typeof first === "string" && first.length >= 10) return first.slice(0, 10);
  return (repo.createdAt || "").slice(0, 10);
}

function formatDates(firstISO: string, lastISO?: string | null): string {
  if (!firstISO) return "";
  const first = firstISO.slice(0, 7); // YYYY-MM
  if (!lastISO) return first;
  const last = lastISO.slice(0, 7);
  if (first === last) return first;
  return `${first} → ${last}`;
}
