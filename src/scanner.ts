import { OpenRouter, tool, stepCountIs } from "@openrouter/agent";
import type { StreamableOutputItem } from "@openrouter/agent";
import * as z from "zod/v4";
import {
  executeBash,
  BASH_TOOL_DESCRIPTION,
  SUBMIT_TOOL_DESCRIPTION,
} from "./tools.js";
import { SCANNER_SYSTEM_PROMPT } from "./prompts.js";
import {
  gatherInventory,
  formatInventoryForAgent,
  type Inventory,
} from "./git-inventory.js";
import {
  ScanResultSchema,
  type ScanResult,
  type FinalScanResult,
} from "./schemas.js";

const MAX_ITERATIONS = 300;

export interface ScannerOptions {
  repoPath: string;
  handle: string;
  model: string;
  onProgress?: (text: string) => void;
}

interface RunnerContext {
  inventory: Inventory;
  repoPath: string;
  handle: string;
  model: string;
  todayIso: string;
  todayDate: string;
  log: (text: string) => void;
  onResultCaptured: (result: ScanResult) => void;
}

export async function runScanner(options: ScannerOptions): Promise<FinalScanResult> {
  const log = options.onProgress ?? ((t: string) => process.stderr.write(t));
  const startTime = new Date();

  log(`[scan] Gathering inventory...\n`);
  const inventory = await gatherInventory(options.repoPath, options.handle);

  if (!inventory.isGitRepo) {
    throw new Error(`${options.repoPath} is not a git repository`);
  }

  log(`[scan] Repo: ${inventory.repoName}\n`);
  log(
    `[scan] Resolved identity: ${inventory.resolvedIdentity ? `${inventory.resolvedIdentity.name} <${inventory.resolvedIdentity.email}> (${inventory.resolvedIdentity.commits} commits)` : "(unresolved — agent will try from shortlog)"}\n`
  );
  log(
    `[scan] Repo totals: ${inventory.totalCommitsAll} commits, ${inventory.totalContributors} contributors, ${inventory.nonUserCommitCount} non-user commits\n`
  );
  log(
    `[scan] User active window: ${inventory.activeDays} days${inventory.userIsEarlyCommitter ? " (⚠ early-committer flag — rampUpDays should be null)" : ""}\n`
  );
  log(
    `[scan] Ownership matrix: ${inventory.ownershipStats.substantiveCommits} substantive commits, ${inventory.ownershipStats.withFollowups} with follow-ups, ${inventory.ownershipStats.totalFollowups} total follow-ups\n`
  );
  log(
    `[scan] Deleted top-50 files: ${inventory.deletedFilesStats.totalDeletedInTop50} total — ${inventory.deletedFilesStats.durableCount} durable (~${inventory.deletedFilesStats.durableUserLocEstimate.toLocaleString()} LOC), ${inventory.deletedFilesStats.ephemeralCount} ephemeral (~${inventory.deletedFilesStats.ephemeralUserLocEstimate.toLocaleString()} LOC)\n`
  );

  const resultRef: { value: ScanResult | null } = { value: null };
  const onResultCaptured = (result: ScanResult) => {
    resultRef.value = result;
    log(`\n[scan] submit_scan_result called — result captured\n`);
  };

  const todayIso = startTime.toISOString();
  const todayDate = todayIso.slice(0, 10);

  const ctx: RunnerContext = {
    inventory,
    repoPath: options.repoPath,
    handle: options.handle,
    model: options.model,
    todayIso,
    todayDate,
    log,
    onResultCaptured,
  };

  await runAgentLoop(ctx);

  if (!resultRef.value) {
    throw new Error(
      "Scanner agent finished without calling submit_scan_result. Review the trace above."
    );
  }

  const captured = resultRef.value;
  return {
    ...captured,
    scannedAt: startTime.toISOString(),
  };
}

function buildInitialMessage(ctx: RunnerContext): string {
  return `## Current date
Today's date is **${ctx.todayDate}** (${ctx.todayIso}). Trust this — git timestamps in this repo should be interpreted relative to it.

${formatInventoryForAgent(ctx.inventory)}

---

Analyze this git repository for contributions by the GitHub user @${ctx.handle}. **Read the entire inventory above** (including the pre-computed blame table, deleted-file lifecycle, and ownership follow-up matrix) before running any bash commands. Then work through the three metrics — Durability, Adaptability, Ownership — efficiently. When you have enough evidence, call submit_scan_result with the final JSON.`;
}

// ---------- OpenRouter agent loop (streaming + forcing-retry) ----------
//
// Uses @openrouter/sdk + @openrouter/agent following the official "create-agent"
// skill patterns:
// - client.callModel(...) method form
// - items-based streaming via result.getItemsStream() with delta logging
// - reasoning parsed via item.content (reasoning_text), fallback to item.summary
// - function_call lifecycle tracked via item.status
// - stopWhen: [stepCountIs(N)] as an array
//
// Forcing-retry: if the model finishes without calling submit_scan_result, we
// re-prompt with the previous narrative embedded plus a strong "call the tool
// NOW" instruction. This catches models like Kimi K2.5 that confuse narrating
// the result with actually submitting it.

async function runAgentLoop(ctx: RunnerContext): Promise<void> {
  const { log } = ctx;

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");

  const client = new OpenRouter({
    apiKey,
    httpReferer: "https://github.com/yatendrakumar/gitshow",
    appTitle: "GitShow Scanner",
    // 1 hour — agentic runs with high-effort reasoning on a ~170K-token
    // inventory can easily take 10-20 minutes. The default 2-minute HTTP
    // timeout would kill streams mid-reasoning.
    timeoutMs: 3_600_000,
  });

  // Track whether the agent ever actually called submit_scan_result.
  let resultCaptured = false;

  const bashTool = tool({
    name: "bash",
    description: BASH_TOOL_DESCRIPTION,
    inputSchema: z.object({
      command: z.string().describe("The bash command to execute in the repo root"),
    }),
    execute: async (input) => executeBash(ctx.repoPath, input.command),
  });

  const submitTool = tool({
    name: "submit_scan_result",
    description: SUBMIT_TOOL_DESCRIPTION,
    inputSchema: ScanResultSchema,
    execute: async (input) => {
      resultCaptured = true;
      ctx.onResultCaptured(input as ScanResult);
      return "Scan result accepted. End the turn now — the caller has the data.";
    },
  });

  const extractMessageText = (item: StreamableOutputItem): string => {
    if (item.type !== "message") return "";
    let text = "";
    for (const part of item.content) {
      const p = part as { type?: string; text?: string };
      if (p.type === "output_text" && typeof p.text === "string") {
        text += p.text;
      }
    }
    return text;
  };

  const extractReasoningText = (item: StreamableOutputItem): string => {
    if (item.type !== "reasoning") return "";
    if (item.content && item.content.length > 0) {
      let text = "";
      for (const part of item.content) {
        const p = part as { type?: string; text?: string };
        if (p.type === "reasoning_text" && typeof p.text === "string") {
          text += p.text;
        }
      }
      if (text) return text;
    }
    if (item.summary && item.summary.length > 0) {
      let text = "";
      for (const part of item.summary) {
        const p = part as { type?: string; text?: string };
        if (typeof p.text === "string") text += p.text;
      }
      return text;
    }
    return "";
  };

  // Buffer assistant message text per item id so we can echo it back if we
  // need to force a retry.
  const messageBufferById = new Map<string, string>();
  const getAssistantText = (): string =>
    [...messageBufferById.values()].join("\n\n").trim();

  // Streaming closure that drives a single callModel result. Shares the
  // outer-scope state so we can call it twice for the forcing-retry pattern.
  const streamResult = async (
    result: ReturnType<typeof client.callModel>,
    label: string
  ): Promise<void> => {
    log(`\n[scan] ${label}\n`);

    const lastMessageLen = new Map<string, number>();
    const lastReasoningLen = new Map<string, number>();
    const loggedFunctionCallStart = new Set<string>();
    const loggedFunctionCallComplete = new Set<string>();
    const loggedToolOutputs = new Set<string>();
    let stepCounter = 0;

    try {
      for await (const item of result.getItemsStream()) {
        const itemId = (item as { id?: string }).id ?? "";

        switch (item.type) {
          case "message": {
            const fullText = extractMessageText(item);
            messageBufferById.set(itemId, fullText);
            const prev = lastMessageLen.get(itemId) ?? 0;
            if (fullText.length > prev) {
              log(fullText.slice(prev));
              lastMessageLen.set(itemId, fullText.length);
            }
            break;
          }
          case "reasoning": {
            const fullText = extractReasoningText(item);
            const prev = lastReasoningLen.get(itemId) ?? 0;
            if (fullText.length > prev) {
              if (prev === 0) log(`\n[thinking] `);
              log(fullText.slice(prev));
              lastReasoningLen.set(itemId, fullText.length);
            }
            break;
          }
          case "function_call": {
            const callKey = item.callId || itemId;
            if (!loggedFunctionCallStart.has(callKey)) {
              loggedFunctionCallStart.add(callKey);
              stepCounter++;
              log(`\n━━━━━━ step ${stepCounter} ━━━━━━\n`);
              log(`→ tool: ${item.name}`);
            }
            if (
              item.status === "completed" &&
              !loggedFunctionCallComplete.has(callKey)
            ) {
              loggedFunctionCallComplete.add(callKey);
              log(` [calling…]`);
            }
            break;
          }
          case "function_call_output": {
            const outKey = (item as { callId?: string }).callId ?? itemId;
            if (!loggedToolOutputs.has(outKey)) {
              loggedToolOutputs.add(outKey);
              log(` [done]`);
            }
            break;
          }
          default:
            break;
        }
      }

      const response = await result.getResponse();
      const usage = (response as { usage?: Record<string, unknown> }).usage;
      if (usage) {
        log(`\n[scan] Phase finished. Usage: ${JSON.stringify(usage)}\n`);
      } else {
        log(`\n[scan] Phase finished.\n`);
      }
    } catch (err) {
      log(
        `\n[scan] Error during agent run: ${(err as Error).message}\n`
      );
      throw err;
    }
  };

  // ----- Attempt 1: full agentic run with high-effort reasoning -----
  const initialMessage = buildInitialMessage(ctx);
  const result1 = client.callModel({
    model: ctx.model,
    instructions: SCANNER_SYSTEM_PROMPT,
    input: initialMessage,
    tools: [bashTool, submitTool] as const,
    stopWhen: [stepCountIs(MAX_ITERATIONS)],
    reasoning: { effort: "high" },
  });
  await streamResult(result1, "Starting agent loop with streaming");

  // ----- Attempt 2: forcing retry if the model ended without submitting -----
  if (!resultCaptured) {
    const previousAnalysis = getAssistantText().slice(0, 30000);
    log(
      `\n[scan] ⚠️  Agent finished without calling submit_scan_result. Re-prompting with the previous analysis embedded and a forced submit instruction.\n`
    );

    const forcingMessage = `You previously analyzed a git repository (the full inventory was provided in your prior context). Your previous text response is reproduced verbatim below. **DO NOT redo any of this work, DO NOT run any bash commands, DO NOT regenerate the analysis.**

---BEGIN PREVIOUS ANALYSIS---
${previousAnalysis}
---END PREVIOUS ANALYSIS---

## ⚠️ CRITICAL: You did NOT call submit_scan_result on your previous turn

Your analysis above is good, but you ended your turn without making the actual tool call. The wrapper that runs you cannot read narrative text — it ONLY captures structured tool calls. Your analysis was effectively thrown away.

**Your only job now: convert your analysis above into the submit_scan_result JSON and call the tool.**

- Do NOT run bash commands. The data is in your prior analysis.
- Do NOT narrate "I will now submit". Just make the tool call.
- Do NOT explain your reasoning again.
- The next thing in your output should be the submit_scan_result tool call, not text.

The submit_scan_result schema requires these fields:
- \`handle\`, \`repoName\`, \`archetype\`, \`archetypeRationale\`
- \`repoSummary\` (totalCommitsByUser, totalCommitsInRepo, firstCommitDate, lastCommitDate, primaryLanguages, activeDays)
- \`durability\` (score, linesSampled, linesSurviving, durableReplacedLines, meaningfulRewrites, noiseRewrites, evidence, confidence)
- \`adaptability\` (rampUpDays, languagesShipped, recentNewTech, evidence, confidence)
- \`ownership\` (score, commitsAnalyzed, commitsRequiringCleanup, soloMaintained, evidence, confidence)
- \`commitClassifications\` (array, max 50)
- \`notes\`

Call submit_scan_result NOW with the populated schema.`;

    const result2 = client.callModel({
      model: ctx.model,
      instructions: SCANNER_SYSTEM_PROMPT,
      input: forcingMessage,
      tools: [bashTool, submitTool] as const,
      stopWhen: [stepCountIs(20)],
      reasoning: { effort: "low" },
    });
    await streamResult(
      result2,
      "Forced retry: must call submit_scan_result now"
    );
  }

  if (!resultCaptured) {
    throw new Error(
      "Scanner agent finished without calling submit_scan_result, even after a forced retry. The model may not reliably support tool calling for this workload — try a different model (e.g., anthropic/claude-sonnet-4.6, z-ai/glm-4.6, or openai/gpt-5)."
    );
  }
}
