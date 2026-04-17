/**
 * System Mapper agent — groups repos into logical systems.
 *
 * Model: Haiku (fast classification task, no bash needed).
 * Input: list of repos with metadata.
 * Output: SystemMapping { systems[], standalone[] }.
 */

import { tool } from "@openrouter/agent";
import * as z from "zod/v4";
import { runAgentWithSubmit } from "./base.js";
import { SYSTEM_MAPPER_PROMPT } from "../prompts/system-mapper.js";
import { SystemMappingResultSchema } from "../schemas.js";
import type { RepoRef, SystemMapping } from "../types.js";

interface SystemMapperInput {
  repos: RepoRef[];
}

export async function runSystemMapper(
  input: SystemMapperInput,
  config: {
    model?: string;
    onProgress?: (text: string) => void;
  } = {}
): Promise<SystemMapping> {
  const repoSummaries = input.repos.map((r) => ({
    name: r.name,
    fullName: r.fullName,
    owner: r.owner,
    description: r.description,
    primaryLanguage: r.primaryLanguage,
    languages: r.languages,
    stars: r.stargazerCount,
    isFork: r.isFork,
    isPrivate: r.isPrivate,
  }));

  const inputMessage = `## Repositories to group

${JSON.stringify(repoSummaries, null, 2)}

Group these ${repoSummaries.length} repositories into logical systems. Call submit_systems when done.`;

  const { result } = await runAgentWithSubmit({
    model: config.model ?? "anthropic/claude-sonnet-4.6",
    systemPrompt: SYSTEM_MAPPER_PROMPT,
    input: inputMessage,
    submitToolName: "submit_systems",
    submitToolDescription:
      "Submit the system grouping result. Call this exactly once with all systems identified.",
    submitSchema: SystemMappingResultSchema,
    reasoning: { effort: "medium" },
    onProgress: config.onProgress,
  });

  return result;
}
