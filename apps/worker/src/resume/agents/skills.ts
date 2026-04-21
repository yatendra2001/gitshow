/**
 * skills-agent — produces the portfolio's Skills pills.
 *
 * Strategy: the normalize stage already aggregates language bytes across
 * repos, and dependency files surface framework usage. We give the LLM
 * a compact "skills ledger" (top languages by insertions, top frameworks
 * detected, stars-weighted tech from top repos) and ask it to curate a
 * 10-12 item ordered list — the items the developer is most credibly
 * known for, in skill-weight order.
 *
 * `iconKey` is a free-form string; the renderer resolves it against the
 * portfolio template's SVG registry (React, Next.js, Python, Go, Postgres,
 * Docker, Kubernetes, Java, C#, TypeScript). Keys that don't resolve just
 * render as plain text pills — no failure mode.
 */

import * as z from "zod/v4";
import { runAgentWithSubmit } from "../../agents/base.js";
import type { ScanSession, Artifact } from "../../schemas.js";
import type { SessionUsage } from "../../session.js";
import type { GitHubData } from "../../types.js";

export const SkillSchema = z.object({
  name: z.string().max(40).describe("Display label for the pill — 'TypeScript', 'Postgres', 'Next.js'"),
  iconKey: z
    .string()
    .max(40)
    .optional()
    .describe(
      "Icon registry key. Known keys: react, nextjs, typescript, nodejs, python, " +
      "go, postgres, docker, kubernetes, java, csharp. Omit for skills without " +
      "a canonical icon — the pill still renders with just the name.",
    ),
});
export type Skill = z.infer<typeof SkillSchema>;

export const SkillsAgentOutputSchema = z.object({
  skills: z
    .array(SkillSchema)
    .min(4)
    .max(12)
    .describe(
      "4-12 skills, ordered by strongest claim first. Prefer specific languages + " +
      "frameworks over generic tags ('TypeScript' over 'JavaScript frameworks').",
    ),
});
export type SkillsAgentOutput = z.infer<typeof SkillsAgentOutputSchema>;

export interface SkillsAgentInput {
  session: ScanSession;
  usage: SessionUsage;
  github: GitHubData;
  artifacts: Record<string, Artifact>;
  onProgress?: (text: string) => void;
}

const SYSTEM_PROMPT = `You curate the Skills pills for an engineering portfolio.

Given a skills ledger derived from GitHub (top languages by bytes, top frameworks, dependency-file detections, top-starred repo stacks), pick 4-12 skills the developer is most credibly known for. Order from strongest to weakest.

Guidelines:
- Prefer SPECIFIC over generic. "Next.js" beats "React frameworks". "Postgres" beats "SQL databases".
- Prefer SHIPPED over EXPERIMENTED. A language with 50k+ insertions across 5+ repos is a real skill. A language with one 200-line toy is not.
- Consolidate: don't list "TypeScript" and "JavaScript" separately if TypeScript dominates — TypeScript wins.
- Don't invent skills. Only pick from what the input data actually shows.
- 10 is a good target. Going below 6 or above 12 is rare.

iconKey — set one of these when the skill has a canonical mark:
  react, nextjs, typescript, nodejs, python, go, postgres, docker, kubernetes, java, csharp
Omit iconKey for skills without a canonical icon (Tailwind, Anthropic SDK, GraphQL, etc.) — the pill still renders with just the name.

Call submit_skills exactly once.`;

export async function runSkillsAgent(
  input: SkillsAgentInput,
): Promise<SkillsAgentOutput> {
  const userMessage = buildInput(input);

  const { result } = await runAgentWithSubmit({
    model: input.session.model,
    systemPrompt: SYSTEM_PROMPT,
    input: userMessage,
    submitToolName: "submit_skills",
    submitToolDescription:
      "Submit the curated 4-12 skills with ordered weighting. Call exactly once.",
    submitSchema: SkillsAgentOutputSchema,
    reasoning: { effort: "medium" },
    session: input.session,
    usage: input.usage,
    label: "resume:skills",
    onProgress: input.onProgress,
  });

  return result;
}

function buildInput(input: SkillsAgentInput): string {
  const { github, artifacts } = input;
  const lines: string[] = [];

  lines.push(`## Skills ledger`);
  lines.push("");

  // Language aggregation: bytes weighted across top repos.
  const langBytes: Record<string, number> = {};
  for (const r of github.ownedRepos) {
    if (r.isArchived) continue;
    for (const lang of r.languages) {
      langBytes[lang] = (langBytes[lang] ?? 0) + (r.stargazerCount ?? 1) * 1000;
    }
  }
  const langEntries = Object.entries(langBytes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);
  if (langEntries.length > 0) {
    lines.push(`### Top languages (weighted by repo presence + stars):`);
    for (const [lang, weight] of langEntries) {
      lines.push(`- ${lang} (score ${weight})`);
    }
    lines.push("");
  }

  // Frameworks / dep-file signals from inventory artifacts.
  const frameworkCounts: Record<string, number> = {};
  for (const a of Object.values(artifacts)) {
    if (!a.id.startsWith("inventory:")) continue;
    const m = a.metadata as Record<string, unknown>;
    const deps = Array.isArray(m.top_dependencies)
      ? (m.top_dependencies as string[])
      : [];
    for (const d of deps) {
      frameworkCounts[d] = (frameworkCounts[d] ?? 0) + 1;
    }
  }
  const frameworkEntries = Object.entries(frameworkCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25);
  if (frameworkEntries.length > 0) {
    lines.push(`### Frameworks / libraries seen across repos (count = repos using it):`);
    for (const [fw, count] of frameworkEntries) {
      lines.push(`- ${fw} (${count} repos)`);
    }
    lines.push("");
  }

  // Top-starred repos — their stack is the clearest signal of "used in anger".
  const topStarred = github.ownedRepos
    .filter((r) => !r.isArchived && !r.isFork)
    .sort((a, b) => (b.stargazerCount ?? 0) - (a.stargazerCount ?? 0))
    .slice(0, 8);
  if (topStarred.length > 0) {
    lines.push(`### Top-starred repos (stack signal):`);
    for (const r of topStarred) {
      const langs = r.languages.slice(0, 4).join(", ") || r.primaryLanguage || "?";
      lines.push(`- ${r.fullName} [${langs}] ★${r.stargazerCount ?? 0}`);
    }
    lines.push("");
  }

  lines.push(`---`);
  lines.push(`Pick 4-12 skills, ordered, with iconKey for known icons. Then call submit_skills.`);
  return lines.join("\n");
}
