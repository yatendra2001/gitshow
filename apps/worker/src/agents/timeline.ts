/**
 * Timeline agent — produces chart-ready career arc data.
 *
 * The UI wants a timeline of meaningful events (year, month, label, type,
 * major) it can plot as three-stream chart (OSS / job / solo / win). This
 * agent looks at the discover paragraph, worker claims, and shipped list,
 * and emits a deduplicated chronology. Small, cheap LLM call.
 */

import { runAgentWithSubmit, type AgentEventEmit } from "./base.js";
import { toolLabel } from "@gitshow/shared/phase-copy";
import { renderDiscoverSummary, renderWorkerClaims } from "./prompt-helpers.js";
import * as z from "zod/v4";
import type {
  ScanSession,
  DiscoverOutput,
  WorkerOutput,
} from "../schemas.js";
import type { SessionUsage } from "../session.js";

export const TimelineEntrySchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z
    .number()
    .int()
    .min(1)
    .max(12)
    .optional()
    .describe("1-12 if known. Omit when only the year is certain."),
  label: z.string().max(80).describe("Short event label, 2-5 words"),
  note: z.string().max(120).optional().describe("One-line detail"),
  type: z.enum(["oss", "job", "solo", "win"]).describe(
    "oss = external OSS contribution. " +
    "job = team/employer work (team repo). " +
    "solo = personal project. " +
    "win = hackathon win / award / recognition.",
  ),
  major: z.boolean().default(false).describe("Headline events only — cap 4 total."),
});
export type TimelineEntry = z.infer<typeof TimelineEntrySchema>;

export const TimelineOutputSchema = z.object({
  entries: z
    .array(TimelineEntrySchema)
    .min(3)
    .max(16)
    .describe("Chronological career events. 6-12 is typical."),
});
export type TimelineOutput = z.infer<typeof TimelineOutputSchema>;

export interface TimelineInput {
  session: ScanSession;
  usage: SessionUsage;
  discover: DiscoverOutput;
  workerOutputs: WorkerOutput[];
  shippedClaims: Array<{ text: string; label?: string; sublabel?: string }>;
  onProgress?: (text: string) => void;
  emit?: AgentEventEmit;
  messageId?: string;
}

const TIMELINE_PROMPT = `You produce a chronological career timeline for a developer — chart-ready data, not prose.

Given the discover paragraph, worker findings, and shipped list, output a timeline of 6–12 events with \`{year, month?, label, note?, type, major}\`.

TYPES (pick one per entry)
  - oss:  external OSS contribution accepted/merged
  - job:  work on a team/employer codebase (start date, milestone release, significant launch)
  - solo: personal project ship date
  - win:  hackathon/award/selection

RULES
  - Oldest event first, most recent last.
  - Use month when the data gives you a month; omit it when only the year is certain.
  - label is SHORT (2–5 words). Shape: "<project> <what-shipped>", "<company> starts", "<hackathon> winner".
  - note is a single detail ("Merged PR #3302", "#1 committer starts"). Skip if redundant.
  - At most 4 \`major: true\` entries — the ones a reader should notice first. These are peaks (job start, big launch, biggest win).
  - Don't invent dates. If a date isn't in the input, don't include that event.

Call submit_timeline exactly once.`;

export async function runTimelineAgent(input: TimelineInput): Promise<TimelineOutput> {
  const userMessage = buildInput(input);

  const { result } = await runAgentWithSubmit<TimelineOutput>({
    model: input.session.model,
    systemPrompt: TIMELINE_PROMPT,
    input: userMessage,
    submitToolName: "submit_timeline",
    submitToolDescription: "Submit the chronological timeline.",
    submitSchema: TimelineOutputSchema,
    reasoning: { effort: "medium" },
    session: input.session,
    usage: input.usage,
    label: "timeline",
    onProgress: input.onProgress,
    emit: input.emit,
    messageId: input.messageId,
    toolLabels: (n, i) => toolLabel(n, i),
  });

  return result;
}

function buildInput(input: TimelineInput): string {
  const lines: string[] = [
    renderDiscoverSummary(input.discover),
    renderWorkerClaims(input.workerOutputs, "## Worker claims (for date-of-event signals)"),
    ``,
    `## Shipped list (each likely = 1 timeline entry)`,
  ];
  for (const s of input.shippedClaims) {
    lines.push(`- [${s.label ?? ""}]  ${s.text}`);
    if (s.sublabel) lines.push(`    ${s.sublabel}`);
  }
  lines.push(``, `Produce the timeline. Call submit_timeline.`);
  return lines.join("\n");
}
