import { getCloudflareContext } from "@opennextjs/cloudflare";
import { parse, Allow } from "partial-json";
import { requireProApi } from "@/lib/entitlements";
import { loadDraftResume, loadPublishedResume } from "@/lib/resume-io";
import { distillResume } from "@/lib/resume-doc-ai";
import {
  newTailoredId,
  writeTailoredResume,
} from "@/lib/tailored-resume-io";
import {
  TAILOR_OPENROUTER_URL,
  TAILOR_SONNET_MODEL,
  TAILOR_SYSTEM_PROMPT,
  buildTailoredFromAI,
  coerceTailoredFromAI,
} from "@/lib/tailored-resume-ai";
import {
  buildJdExcerpt,
  type TailoredResume,
} from "@gitshow/shared/tailored-resume";

/**
 * POST /api/resume/tailored/stream
 *
 * Body: { jobDescription: string }
 *
 * Streams Server-Sent Events as the AI generates a JD-tailored resume
 * directly from the user's portfolio. No "base resume" step — every
 * resume in gitshow is tied to a JD, so we go portfolio + JD → resume
 * in a single AI call.
 *
 * Wire format:
 *   data: {"type":"partial","doc":{...partial ResumeDoc...},"jobTitle":"...","company":"..."}
 *   data: {"type":"done","tailored":{...full TailoredResume...}}
 *   data: {"type":"error","error":"...","detail":"..."}
 *
 * The final `done` event carries the validated TailoredResume + meta
 * — the client uses that both to refresh the list AND to navigate to
 * the new variant's editor.
 */

export const maxDuration = 120;

const ENC = new TextEncoder();
const MAX_JD_LENGTH = 16_000;

function sse(data: unknown): Uint8Array {
  return ENC.encode(`data: ${JSON.stringify(data)}\n\n`);
}

export async function POST(req: Request) {
  const gate = await requireProApi();
  if (!gate.ok) return gate.response;
  const session = gate.session;
  if (!session.user.login) {
    return jsonError("no_handle", 400);
  }

  const { env } = await getCloudflareContext({ async: true });
  if (!env.BUCKET) return jsonError("r2_not_bound", 500);
  if (!env.OPENROUTER_API_KEY) return jsonError("ai_not_configured", 500);

  const body = (await req.json().catch(() => null)) as
    | { jobDescription?: unknown }
    | null;
  const jd =
    body && typeof body.jobDescription === "string"
      ? body.jobDescription.trim()
      : "";
  if (!jd) {
    return jsonError(
      "missing_job_description",
      400,
      "Paste a job description to tailor against.",
    );
  }
  if (jd.length > MAX_JD_LENGTH) {
    return jsonError(
      "job_description_too_long",
      400,
      `Job description exceeds ${MAX_JD_LENGTH} characters.`,
    );
  }

  const handle = session.user.login;
  const [published, draft] = await Promise.all([
    loadPublishedResume(env.BUCKET, handle),
    loadDraftResume(env.BUCKET, handle),
  ]);
  const portfolio = published ?? draft;
  if (!portfolio) {
    return jsonError(
      "no_portfolio",
      404,
      "Run a portfolio scan first — every resume is built from it.",
    );
  }

  const baseSourceVersion = portfolio.meta.version ?? 0;
  const bucket = env.BUCKET;

  const upstream = await fetch(TAILOR_OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "HTTP-Referer": env.NEXT_PUBLIC_APP_URL ?? "https://gitshow.io",
      "X-Title": "gitshow",
    },
    body: JSON.stringify({
      model: TAILOR_SONNET_MODEL,
      messages: [
        { role: "system", content: TAILOR_SYSTEM_PROMPT },
        {
          role: "user",
          content: buildPortfolioJdPrompt(distillResume(portfolio), jd),
        },
      ],
      temperature: 0.35,
      response_format: { type: "json_object" },
      stream: true,
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    return jsonError(
      "openrouter_failed",
      502,
      `${upstream.status}: ${detail.slice(0, 400)}`,
    );
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let accumulated = "";
      let lastEmittedSerialized = "";
      let lastEmitTime = 0;
      const reader = upstream.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const tryEmitPartial = (force: boolean) => {
        if (!accumulated) return;
        const now = Date.now();
        // Throttle to ~10 emits/sec — same throttle as base
        // generate-stream. Faster overwhelms the client without
        // visible benefit.
        if (!force && now - lastEmitTime < 90) return;
        try {
          const parsed = parse(accumulated, Allow.ALL);
          const { doc, jobTitle, company } = coerceTailoredFromAI(
            parsed,
            baseSourceVersion,
          );
          const payload = { type: "partial", doc, jobTitle, company };
          const serialized = JSON.stringify(payload);
          if (serialized === lastEmittedSerialized) return;
          lastEmittedSerialized = serialized;
          lastEmitTime = now;
          controller.enqueue(sse(payload));
        } catch {
          // partial-json couldn't parse yet — likely early in the
          // stream. Skip; next chunk will try again.
        }
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const payload = trimmed.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            try {
              const json = JSON.parse(payload) as {
                choices?: Array<{ delta?: { content?: string } }>;
              };
              const delta = json.choices?.[0]?.delta?.content;
              if (typeof delta === "string" && delta.length > 0) {
                accumulated += delta;
                tryEmitPartial(false);
              }
            } catch {
              // Ignore malformed SSE keepalives.
            }
          }
        }

        tryEmitPartial(true);

        try {
          const final = stripCodeFence(accumulated);
          const finalJson = JSON.parse(final) as unknown;
          const validated = buildTailoredFromAI(finalJson, baseSourceVersion);

          const id = newTailoredId();
          const nowIso = new Date().toISOString();
          const tailored: TailoredResume = {
            schemaVersion: 1,
            meta: {
              id,
              jobTitle: validated.jobTitle,
              company: validated.company,
              jdExcerpt: buildJdExcerpt(jd),
              createdAt: nowIso,
              updatedAt: nowIso,
              baseSourceVersion,
            },
            doc: validated.doc,
            jobDescription: jd,
          };

          const written = await writeTailoredResume(bucket, handle, tailored);
          controller.enqueue(sse({ type: "done", tailored: written }));
        } catch (err) {
          const detail = err instanceof Error ? err.message : "unknown";
          controller.enqueue(
            sse({
              type: "error",
              error: "validation_failed",
              detail: detail.slice(0, 400),
            }),
          );
        }
      } catch (err) {
        const detail = err instanceof Error ? err.message : "unknown";
        controller.enqueue(
          sse({ type: "error", error: "stream_failed", detail }),
        );
      } finally {
        controller.close();
        reader.releaseLock();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    return trimmed
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();
  }
  return trimmed;
}

function jsonError(code: string, status: number, detail?: string) {
  return new Response(JSON.stringify({ error: code, detail }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Build the user-message body for the tailoring call. The system
 * prompt asks for portfolio + JD → tailored resume; we pass the
 * distilled portfolio (already trimmed by `distillResume`) and the
 * raw JD text. The tailoring rules in the prompt (no fabrication,
 * impact-first bullets, etc.) work identically whether the input is
 * a previously-generated ResumeDoc or a freshly distilled portfolio.
 */
function buildPortfolioJdPrompt(
  distilledPortfolio: unknown,
  jobDescription: string,
): string {
  return `Tailor a one-page resume from this portfolio against the job below. Return JSON only.

BASE_RESUME (distilled portfolio):
${JSON.stringify(distilledPortfolio, null, 2)}

JOB_DESCRIPTION:
"""
${jobDescription}
"""`;
}
