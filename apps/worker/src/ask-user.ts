/**
 * askUser — the mid-scan agent-question protocol.
 *
 * 1. Insert a row into agent_questions (D1).
 * 2. Emit an `agent-question` event (in-app card shows up instantly).
 * 3. Send an email notification (scan is 40-50 min; the user may be away).
 * 4. Poll agent_answers every 2s until resolved OR timeout_ms elapses.
 * 5. Return the answer — or the default_answer if the user didn't reply
 *    and no default was set, fall back to whatever `fallback` says.
 *
 * Safe to omit email / notifications when they're not configured; we
 * never throw because of a delivery failure.
 */

import { randomUUID } from "node:crypto";
import type { PipelineEvent } from "@gitshow/shared/events";
import type { D1Client } from "./cloud/d1.js";
import type { ResendSender } from "@gitshow/shared/notifications/email";
import type { Logger } from "@gitshow/shared/util";
import { renderAgentQuestion } from "@gitshow/shared/notifications/email";

export interface AskUserInput {
  d1: D1Client;
  scanId: string;
  handle: string;
  stage: string;
  question: string;
  options?: Array<{ value: string; label: string }>;
  default_answer?: string;
  /** Hard timeout. Default 30 minutes. */
  timeout_ms?: number;
  emit: (ev: PipelineEvent) => void;
  email?: ResendSender | null;
  publicAppUrl?: string;
  messageId?: string;
  log?: Logger;
  /** How often to poll agent_answers. Default 2s. */
  pollIntervalMs?: number;
  /** Final fallback when no default_answer + no user reply. */
  fallback?: string;
}

export async function askUser(input: AskUserInput): Promise<string> {
  const qid = `q_${randomUUID()}`;
  const timeoutMs = input.timeout_ms ?? 30 * 60 * 1000;
  const pollMs = input.pollIntervalMs ?? 2000;
  const now = Date.now();

  await input.d1.createAgentQuestion({
    id: qid,
    scan_id: input.scanId,
    message_id: input.messageId ?? null,
    stage: input.stage,
    question: input.question,
    options: input.options,
    default_answer: input.default_answer ?? null,
    timeout_ms: timeoutMs,
  });

  input.emit({
    kind: "agent-question",
    question_id: qid,
    question: input.question,
    ...(input.options ? { options: input.options } : {}),
    timeout_ms: timeoutMs,
    default_answer: input.default_answer,
    stage: input.stage as
      | "intake"
      | "discover"
      | "workers"
      | "hook"
      | "numbers"
      | "disclosure"
      | "shipped"
      | "critic"
      | "revise",
    ...(input.messageId ? { message_id: input.messageId } : {}),
  });

  // Notify — email is the critical channel since the user is likely
  // off-tab. Desktop push arrives via the separately-wired sender.
  if (input.email && input.publicAppUrl) {
    try {
      const userIdResp = await input.d1.getUserIdForScan(input.scanId);
      if (userIdResp) {
        const contact = await input.d1.getUserContactById(userIdResp);
        if (contact?.email) {
          const tpl = renderAgentQuestion({
            handle: input.handle,
            stage: input.stage,
            question: input.question,
            answerUrl: `${input.publicAppUrl}/app/scan/${encodeURIComponent(input.scanId)}?q=${encodeURIComponent(qid)}`,
            expiresInMinutes: Math.round(timeoutMs / 60_000),
          });
          void input.email.send({
            to: contact.email,
            subject: tpl.subject,
            html: tpl.html,
            text: tpl.text,
            tags: [
              { name: "kind", value: "agent-question" },
              { name: "scan_id", value: input.scanId },
            ],
          });
        }
      }
    } catch (err) {
      input.log?.warn?.(
        { err: err instanceof Error ? err.message : String(err) },
        "askUser.email.failed",
      );
    }
  }

  // Poll for the answer.
  const deadline = now + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const result = await input.d1.getPendingAnswerForQuestion(qid);
      if (result && result.answer !== null && result.answer !== undefined) {
        input.emit({
          kind: "agent-answer",
          question_id: qid,
          answer: result.answer,
          source: "user",
          ...(input.messageId ? { message_id: input.messageId } : {}),
        });
        return result.answer;
      }
    } catch (err) {
      input.log?.warn?.(
        { err: err instanceof Error ? err.message : String(err) },
        "askUser.poll.failed",
      );
    }
    await sleep(pollMs);
  }

  // Timeout path. Emit a synthetic answer so the UI collapses the
  // question card cleanly, then return whatever default we have.
  const fallback = input.default_answer ?? input.fallback ?? "";
  input.emit({
    kind: "agent-answer",
    question_id: qid,
    answer: fallback,
    source: "timeout-default",
    ...(input.messageId ? { message_id: input.messageId } : {}),
  });
  return fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
