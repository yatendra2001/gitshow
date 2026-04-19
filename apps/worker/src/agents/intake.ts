/**
 * Intake agent — runs before the full scan.
 *
 * Reads a light slice of the user's GitHub (bio + top 5 active repos +
 * recent PR count) and asks Claude to propose 3–5 targeted questions
 * the user can answer in under a minute. Answers feed into the full
 * scan as context so the 40–50 min run has a clearer target from the
 * start.
 *
 * This is a single LLM call — no tools, no loops. Fast (~15–30s).
 * Output is schema-enforced so the web app can render the questions
 * verbatim.
 */

import { z } from "zod/v4";
import { runAgentWithSubmit, type AgentEventEmit } from "./base.js";
import type { ScanSession } from "../schemas.js";
import type { SessionUsage } from "../session.js";

export const IntakeQuestionSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(8).max(240),
  /** Short hint under the input — why we're asking. */
  why: z.string().max(160).optional(),
  /**
   * If the agent can credibly suggest 2-4 discrete answers, it
   * provides them and the UI renders a chip picker instead of a
   * text input. Free-form text is always allowed via an "Other" chip.
   */
  options: z
    .array(
      z.object({
        value: z.string().min(1),
        label: z.string().min(1).max(60),
      }),
    )
    .max(4)
    .optional(),
  /** Optional default if the user chooses to skip. */
  default: z.string().max(240).optional(),
});

export type IntakeQuestion = z.infer<typeof IntakeQuestionSchema>;

export const IntakeOutputSchema = z.object({
  /** One-line read of what the agent saw — not user-facing, but logged for QA. */
  read_summary: z.string().max(400),
  questions: z.array(IntakeQuestionSchema).min(3).max(5),
});

export type IntakeOutput = z.infer<typeof IntakeOutputSchema>;

export interface IntakeInput {
  session: ScanSession;
  usage: SessionUsage;
  /** Compact profile summary (handle, bio, location, top repos, recent activity). */
  profile_summary: string;
  onProgress?: (text: string) => void;
  emit?: AgentEventEmit;
  messageId?: string;
}

const INTAKE_PROMPT = `You are running a 60-second intake before a 40-minute agentic scan of a developer's GitHub. Your one job: generate 3-5 questions that meaningfully steer the scan.

You'll see a compact profile summary — bio, top active repos, recent PR cadence, socials.

Rules:
- Ask things the scan CAN'T figure out on its own: positioning intent, employment context, preferred framing, things to skip.
- Keep each question short and human. No corporate/HR tone. "What's your current situation?" beats "Please describe your employment status."
- If you can suggest 2-4 distinct options, do — the UI renders them as chips. Otherwise leave options out; users will free-form.
- ALWAYS include a question that surfaces choice: "Any repos you'd rather I NOT analyze?" is great because it respects the user's authorship.
- If the bio or top-repos strongly suggest one positioning, ask the user to confirm / redirect it — don't assume.
- Avoid yes/no questions. They're useless downstream.
- Do not ask about things you can measure from the data (commit counts, languages, stars).

Output: call submit_intake with 3-5 questions and a one-line read_summary. Stop there.`;

export async function runIntake(input: IntakeInput): Promise<IntakeOutput> {
  const { result } = await runAgentWithSubmit({
    model: input.session.model,
    systemPrompt: INTAKE_PROMPT,
    input: input.profile_summary,
    submitToolName: "submit_intake",
    submitToolDescription:
      "Submit 3-5 intake questions plus a short read_summary. Call exactly once.",
    submitSchema: IntakeOutputSchema,
    reasoning: { effort: "medium" },
    session: input.session,
    usage: input.usage,
    label: "intake",
    onProgress: input.onProgress,
    emit: input.emit,
    messageId: input.messageId,
  });
  return result;
}
