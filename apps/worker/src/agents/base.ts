/**
 * Generic agent runner extracted from scanner.ts.
 *
 * Provides `runAgent<T>()` — a typed wrapper around OpenRouter's callModel
 * that handles streaming, forcing-retry, progress logging, and result capture.
 *
 * Every agent in the pipeline (system-mapper, repo-analyzer, pr-analyst,
 * synthesizer, evaluator) calls this with their own prompt, tools, and config.
 */

import { OpenRouter, tool, stepCountIs } from "@openrouter/agent";
import type { StreamableOutputItem } from "@openrouter/agent";
import * as z from "zod/v4";
import type { ScanSession } from "../schemas.js";
import type { SessionUsage } from "../session.js";
import { logger } from "../util.js";

const agentLog = logger.child({ src: "agent" });

// ---------- types ----------

export interface AgentRunConfig {
  /** OpenRouter model ID, e.g. "anthropic/claude-sonnet-4.6". */
  model: string;
  /** System prompt for this agent. */
  systemPrompt: string;
  /** User message input (pre-formatted by the caller). */
  input: string;
  /** OpenRouter tool instances created via `tool()`. */
  tools: ReturnType<typeof tool>[];
  /** Safety valve only — NOT a quality cap. Default: 10,000 (effectively unlimited). */
  maxIterations?: number;
  /** Reasoning effort level. Default: "high". */
  reasoning?: { effort: "high" | "medium" | "low" };
  /** HTTP timeout in ms. Default: 2 hours. */
  timeoutMs?: number;
  /** Progress callback for streaming output. */
  onProgress?: (text: string) => void;
  /**
   * Scan session — its `id` is passed as OpenRouter `session_id` on every
   * callModel, so all LLM calls for this scan are grouped in the dashboard.
   * Optional only to keep utility scripts happy; all real agents pass it.
   */
  session?: ScanSession;
  /** Optional usage accumulator — call counts, tokens, estimated cost. */
  usage?: SessionUsage;
  /** Label for this agent run (e.g., "discover", "cross-repo-worker"). Used in logs. */
  label?: string;
}

interface AgentResult<T> {
  result: T;
  tokensUsed: number;
  durationMs: number;
  iterations: number;
}

// ---------- helpers ----------

function extractMessageText(item: StreamableOutputItem): string {
  if (item.type !== "message") return "";
  let text = "";
  for (const part of item.content) {
    const p = part as { type?: string; text?: string };
    if (p.type === "output_text" && typeof p.text === "string") {
      text += p.text;
    }
  }
  return text;
}

function extractReasoningText(item: StreamableOutputItem): string {
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
}

// ---------- core runner ----------

/**
 * Run an OpenRouter agent loop with streaming, forcing-retry, and typed result capture.
 *
 * The caller provides tools created via `tool()` from @openrouter/agent.
 * Exactly ONE of those tools must be the "submit" tool that captures the result.
 * The caller wires the submit tool's `execute` callback to set `resultCaptured`.
 *
 * Usage pattern:
 * ```ts
 * let captured: MyResult | null = null;
 * const submitTool = tool({
 *   name: "submit_result",
 *   description: "...",
 *   inputSchema: MyResultSchema,
 *   execute: async (input) => { captured = input; return "ok"; },
 * });
 * await runAgentLoop({ ..., tools: [bashTool, submitTool] });
 * // captured is now set
 * ```
 */
export async function runAgentLoop(config: AgentRunConfig): Promise<{
  assistantText: string;
  tokensUsed: number;
  durationMs: number;
  iterations: number;
}> {
  const log = config.onProgress ?? (() => {});
  // NO CAPS: agents have unlimited iterations and an effectively-unlimited
  // HTTP timeout. Accuracy and quality > wall-clock. The agent decides when
  // it's done, not an artificial ceiling.
  const maxIter = config.maxIterations ?? 10_000; // safety valve only
  const effort = config.reasoning?.effort ?? "high";
  // 24 hours — long enough that no real scan will ever hit it.
  const timeout = config.timeoutMs ?? 86_400_000;

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");

  const client = new OpenRouter({
    apiKey,
    httpReferer: "https://github.com/yatendrakumar/gitshow",
    appTitle: "GitShow Pipeline",
    timeoutMs: timeout,
  });

  const startTime = Date.now();
  let totalTokens = 0;
  let totalIterations = 0;

  // Buffer assistant text for forcing-retry
  const messageBufferById = new Map<string, string>();
  const getAssistantText = (): string =>
    [...messageBufferById.values()].join("\n\n").trim();

  // Stream a single callModel result
  const streamResult = async (
    result: ReturnType<typeof client.callModel>,
    label: string
  ): Promise<void> => {
    log(`\n[agent] ${label}\n`);

    const lastMessageLen = new Map<string, number>();
    const lastReasoningLen = new Map<string, number>();
    const loggedFunctionCallStart = new Set<string>();
    const loggedFunctionCallComplete = new Set<string>();
    const loggedToolOutputs = new Set<string>();
    let stepCounter = 0;

    // Classify and handle the @openrouter/agent "empty final response" bug:
    // the SDK throws when the assistant ends with just a tool call and no
    // trailing assistant message, even though the tool already executed.
    // We detect this error (from the stream OR from getResponse) and
    // treat it as a successful completion.
    const isEmptyOutputBug = (err: unknown): boolean => {
      // Lowercase both sides — the SDK variously throws "Stream ended..."
      // (capital S) vs "Follow-up stream ended..." (lowercase s). Earlier
      // versions of this check were case-sensitive and missed the first.
      const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
      return (
        msg.includes("empty or invalid output") ||
        msg.includes("invalid final response") ||
        // "Stream ended without completion event" and
        // "Follow-up stream ended without a completed response" — same
        // family. If the tool already ran, we've got our result.
        msg.includes("stream ended") ||
        msg.includes("without completion")
      );
    };

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
            totalIterations++;
            log(`\n--- step ${stepCounter} ---\n`);
            log(`> tool: ${item.name}`);
          }
          if (
            item.status === "completed" &&
            !loggedFunctionCallComplete.has(callKey)
          ) {
            loggedFunctionCallComplete.add(callKey);
            log(` [calling]`);
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

    try {
      const response = await result.getResponse();
      const usage = (response as { usage?: { total_tokens?: number } }).usage;
      if (usage?.total_tokens) {
        totalTokens += usage.total_tokens;
        log(`\n[agent] Phase done. Tokens: ${usage.total_tokens}\n`);
      } else {
        log(`\n[agent] Phase done.\n`);
      }
    } catch (err) {
      if (isEmptyOutputBug(err)) {
        log(`\n[agent] Phase done (SDK empty-output bug bypassed at getResponse).\n`);
      } else {
        throw err;
      }
    }
    } catch (err) {
      // Catches errors thrown from the for-await stream iteration itself
      if (isEmptyOutputBug(err)) {
        log(`\n[agent] Phase done (SDK empty-output bug bypassed at stream).\n`);
        return;
      }
      throw err;
    }
  };

  // ----- Run with retry on transient errors -----
  // Longer retry budget for "empty output" / "invalid final response" —
  // those are often one-off SDK stream hiccups that clear on retry.
  const MAX_TRANSIENT_RETRIES = 6;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
    try {
      const result1 = client.callModel({
        model: config.model,
        instructions: config.systemPrompt,
        input: config.input,
        tools: config.tools as Parameters<typeof client.callModel>[0]["tools"],
        stopWhen: [stepCountIs(maxIter)],
        reasoning: { effort },
        // Group every call under the scan's session so costs + traces are
        // queryable per scan in the OpenRouter dashboard.
        ...(config.session ? { sessionId: config.session.id } : {}),
      });
      await streamResult(result1, `Starting agent loop${config.label ? ` [${config.label}]` : ""}${attempt > 1 ? ` (retry ${attempt})` : ""}`);

      // Record usage
      if (config.usage) {
        config.usage.recordLlmCall({ tokens: totalTokens });
      }

      return {
        assistantText: getAssistantText(),
        tokensUsed: totalTokens,
        durationMs: Date.now() - startTime,
        iterations: totalIterations,
      };
    } catch (err) {
      lastError = err as Error;
      const msg = lastError.message ?? String(err);

      // Classify the error
      if (isTransientError(msg)) {
        log(`\n[agent] Transient error (attempt ${attempt}/${MAX_TRANSIENT_RETRIES}): ${msg}\n`);
        // Also write to stderr so the CLI spinner subtext can show it.
        process.stderr.write(
          `[agent${config.label ? `:${config.label}` : ""}] retry ${attempt}/${MAX_TRANSIENT_RETRIES} — ${msg.slice(0, 140)}\n`,
        );
        // Structured log so cloud deploys see transient retries without
        // needing GITSHOW_DEBUG. Pipeline events stream to D1 separately.
        agentLog.warn(
          {
            label: config.label ?? null,
            attempt,
            max_attempts: MAX_TRANSIENT_RETRIES,
            error: msg.slice(0, 200),
          },
          "transient error, retrying",
        );
        if (attempt < MAX_TRANSIENT_RETRIES) {
          const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 30000);
          log(`[agent] Retrying in ${backoffMs / 1000}s...\n`);
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }
      }

      // Non-transient or exhausted retries — rethrow
      agentLog.error(
        {
          err: lastError,
          label: config.label ?? null,
          attempt,
          transient: isTransientError(msg),
        },
        "agent loop failed",
      );
      throw lastError;
    }
  }

  throw lastError ?? new Error("Agent loop failed after retries");
}

/**
 * Classify whether an error is transient (worth retrying) vs permanent.
 */
function isTransientError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("econnreset") ||
    lower.includes("econnrefused") ||
    lower.includes("socket hang up") ||
    lower.includes("socket connection") ||
    lower.includes("connectionclosed") ||
    lower.includes("connection closed") ||
    lower.includes("closed unexpectedly") ||
    lower.includes("abort") ||
    lower.includes("aborted") ||
    lower.includes("502") ||
    lower.includes("503") ||
    lower.includes("504") ||
    lower.includes("429") || // rate limit
    lower.includes("rate limit") ||
    lower.includes("overloaded") ||
    lower.includes("busy") ||
    lower.includes("internal server error") ||
    lower.includes("bad gateway") ||
    lower.includes("service unavailable") ||
    lower.includes("network") ||
    lower.includes("fetch failed") ||
    lower.includes("getaddrinfo") ||
    lower.includes("dns") ||
    // OpenRouter SDK parsing failures — model returned malformed/truncated response
    lower.includes("invalid final response") ||
    lower.includes("empty or invalid output") ||
    lower.includes("stream ended") || // "Stream ended without completion event", "Follow-up stream ended..."
    lower.includes("without completion") ||
    lower.includes("unexpected end of json") ||
    lower.includes("json parse error") ||
    lower.includes("unterminated string") ||
    lower.includes("maximum context length") ||
    lower.includes("content_filter") ||
    lower.includes("output_length")
  );
}

/**
 * Higher-level helper: run an agent that must call a submit tool to produce a result.
 *
 * Handles the common pattern:
 * 1. Create a submit tool from a Zod schema
 * 2. Run the agent loop
 * 3. If no result captured, run a forcing-retry
 * 4. Return the captured result or throw
 */
export async function runAgentWithSubmit<T>(config: {
  model: string;
  systemPrompt: string;
  input: string;
  /** Additional tools (e.g., bash). The submit tool is added automatically. */
  extraTools?: ReturnType<typeof tool>[];
  submitToolName: string;
  submitToolDescription: string;
  submitSchema: z.ZodType<T>;
  maxIterations?: number;
  reasoning?: { effort: "high" | "medium" | "low" };
  timeoutMs?: number;
  onProgress?: (text: string) => void;
  /** Scan session — threaded as OpenRouter session_id across all attempts. */
  session?: ScanSession;
  /** Usage accumulator. */
  usage?: SessionUsage;
  /** Label for logs. */
  label?: string;
}): Promise<AgentResult<T>> {
  const log = config.onProgress ?? (() => {});

  let captured: T | null = null;

  const submitTool = tool({
    name: config.submitToolName,
    description: config.submitToolDescription,
    inputSchema: config.submitSchema as z.ZodObject<z.ZodRawShape>,
    execute: async (input) => {
      captured = input as T;
      log(`\n[agent] ${config.submitToolName} called - result captured\n`);
      return "Result accepted. End your turn now.";
    },
  });

  const allTools = [...(config.extraTools ?? []), submitTool];

  // Attempt 1: full run
  const run1 = await runAgentLoop({
    model: config.model,
    systemPrompt: config.systemPrompt,
    input: config.input,
    tools: allTools,
    maxIterations: config.maxIterations,
    reasoning: config.reasoning,
    timeoutMs: config.timeoutMs,
    onProgress: config.onProgress,
    session: config.session,
    usage: config.usage,
    label: config.label,
  });

  if (captured) {
    return {
      result: captured,
      tokensUsed: run1.tokensUsed,
      durationMs: run1.durationMs,
      iterations: run1.iterations,
    };
  }

  // Attempt 2: forcing-retry
  log(`\n[agent] WARNING: Agent finished without calling ${config.submitToolName}. Forcing retry.\n`);

  const previousText = run1.assistantText.slice(0, 30000);
  const forcingInput = `You previously analyzed data and produced this text:

---BEGIN PREVIOUS OUTPUT---
${previousText}
---END PREVIOUS OUTPUT---

You did NOT call ${config.submitToolName}. Your analysis above is good, but the system only captures structured tool calls. Convert your analysis into the ${config.submitToolName} tool call NOW. Do not re-analyze. Do not narrate. Just call the tool.`;

  const run2 = await runAgentLoop({
    model: config.model,
    systemPrompt: config.systemPrompt,
    input: forcingInput,
    tools: allTools,
    maxIterations: 20,
    reasoning: { effort: "low" },
    timeoutMs: config.timeoutMs,
    onProgress: config.onProgress,
    session: config.session,
    usage: config.usage,
    label: config.label ? `${config.label}:force` : "force-submit",
  });

  if (captured) {
    return {
      result: captured,
      tokensUsed: run1.tokensUsed + run2.tokensUsed,
      durationMs: run1.durationMs + run2.durationMs,
      iterations: run1.iterations + run2.iterations,
    };
  }

  // Attempt 3: if forcing retry also failed, one more try with explicit schema
  log(`\n[agent] WARNING: Forcing retry also failed. Final attempt with explicit schema.\n`);

  const schemaRetryInput = `You MUST call the ${config.submitToolName} tool NOW.
This is your final chance. If you do not call the tool, the entire run is wasted.

Previous analysis (use this data, do NOT re-analyze):
${run1.assistantText.slice(0, 15000)}

CALL ${config.submitToolName} IMMEDIATELY.`;

  const run3 = await runAgentLoop({
    model: config.model,
    systemPrompt: `You are a JSON submission assistant. Your ONLY job is to call the ${config.submitToolName} tool with the data from the previous analysis. Do not narrate. Do not explain. Just call the tool.`,
    input: schemaRetryInput,
    tools: allTools,
    maxIterations: 10,
    reasoning: { effort: "low" },
    timeoutMs: config.timeoutMs,
    onProgress: config.onProgress,
    session: config.session,
    usage: config.usage,
    label: config.label ? `${config.label}:force-final` : "force-submit-final",
  });

  if (captured) {
    return {
      result: captured,
      tokensUsed: run1.tokensUsed + run2.tokensUsed + run3.tokensUsed,
      durationMs: run1.durationMs + run2.durationMs + run3.durationMs,
      iterations: run1.iterations + run2.iterations + run3.iterations,
    };
  }

  throw new Error(
    `Agent finished without calling ${config.submitToolName} after 3 attempts. ` +
      `Model: ${config.model}. This model may not support tool calling reliably.`
  );
}

// ---------- tool factory helpers ----------

/**
 * Create a bash/run tool for agents that need to execute commands.
 * Uses the Manus-style presentation layer from tools.ts.
 */
export function createBashTool(
  cwd: string,
  executeBash: (cwd: string, command: string) => Promise<string>
) {
  return tool({
    name: "run",
    description:
      "Execute a bash command. Supports git, gh, grep, cat, head, tail, find, jq, and standard Unix tools. " +
      "Compose with pipes: cmd1 | cmd2 | cmd3. " +
      "Output over 200 lines is auto-truncated with a temp file path for exploration. " +
      "Output includes [exit:N | Xms] metadata.",
    inputSchema: z.object({
      command: z
        .string()
        .describe("The bash command to execute. Supports pipes and chains."),
    }),
    execute: async (input) => executeBash(cwd, input.command),
  });
}
