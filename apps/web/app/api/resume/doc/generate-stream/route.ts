import { getCloudflareContext } from "@opennextjs/cloudflare";
import { parse, Allow } from "partial-json";
import { requireProApi } from "@/lib/entitlements";
import { loadDraftResume, loadPublishedResume } from "@/lib/resume-io";
import { writeResumeDoc } from "@/lib/resume-doc-io";
import {
  buildResumeDocFromAI,
  coerceResumeDocFromAI,
  distillResume,
  SYSTEM_PROMPT,
  SONNET_MODEL,
  OPENROUTER_URL,
} from "@/lib/resume-doc-ai";
import type { ResumeDoc } from "@gitshow/shared/resume-doc";

/**
 * POST /api/resume/doc/generate-stream — Server-Sent Events stream of
 * partial ResumeDoc objects as the AI generates them.
 *
 * Wire format (one event per `data:` line, blank line terminator):
 *   data: {"type":"partial","doc":{...partial ResumeDoc...}}
 *   data: {"type":"done","doc":{...validated ResumeDoc...}}
 *   data: {"type":"error","error":"...","detail":"..."}
 *
 * Why streaming? The user sees their resume appear section-by-section
 * (header → experience → projects → ...) which makes the ~10s wait
 * feel like 1s. Better UX than a spinner, and showcases the AI work.
 *
 * Implementation: relay OpenRouter's token stream. Every token batch
 * triggers a partial-json parse on the accumulated text; if it yields
 * a meaningfully-changed doc shape we emit a partial event. The final
 * complete JSON gets strict validation + R2 persist before the `done`
 * event fires.
 */

export const maxDuration = 120;

const ENC = new TextEncoder();

function sse(data: unknown): Uint8Array {
  return ENC.encode(`data: ${JSON.stringify(data)}\n\n`);
}

export async function POST() {
  const gate = await requireProApi();
  if (!gate.ok) return gate.response;
  const session = gate.session;
  if (!session.user.login) {
    return new Response(
      JSON.stringify({ error: "no_handle" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const { env } = await getCloudflareContext({ async: true });
  if (!env.BUCKET) {
    return new Response(
      JSON.stringify({ error: "r2_not_bound" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
  if (!env.OPENROUTER_API_KEY) {
    return new Response(
      JSON.stringify({ error: "ai_not_configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const handle = session.user.login;
  const [published, draft] = await Promise.all([
    loadPublishedResume(env.BUCKET, handle),
    loadDraftResume(env.BUCKET, handle),
  ]);
  const source = published ?? draft;
  if (!source) {
    return new Response(
      JSON.stringify({ error: "no_resume" }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  const distilled = distillResume(source);
  const userPrompt = `Generate a one-page resume from this portfolio data. Return JSON only.\n\nSource:\n${JSON.stringify(distilled, null, 2)}`;

  const upstream = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "HTTP-Referer": env.NEXT_PUBLIC_APP_URL ?? "https://gitshow.io",
      "X-Title": "gitshow",
    },
    body: JSON.stringify({
      model: SONNET_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.4,
      response_format: { type: "json_object" },
      stream: true,
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    return new Response(
      JSON.stringify({
        error: "openrouter_failed",
        detail: `${upstream.status}: ${detail.slice(0, 400)}`,
      }),
      {
        status: 502,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const sourceVersion = source.meta.version ?? 0;
  const bucket = env.BUCKET;

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
        // Throttle to ~10 emits/sec — anything faster overwhelms the
        // client-side render and JSON parser without visible benefit.
        if (!force && now - lastEmitTime < 90) return;
        try {
          const parsed = parse(accumulated, Allow.ALL);
          const doc = coerceResumeDocFromAI(parsed, sourceVersion);
          // Only emit if the projection changed since last emit. Avoids
          // sending 100 identical partials when the model is writing a
          // long string field.
          const serialized = JSON.stringify(doc);
          if (serialized === lastEmittedSerialized) return;
          lastEmittedSerialized = serialized;
          lastEmitTime = now;
          controller.enqueue(sse({ type: "partial", doc }));
        } catch {
          // partial-json failed (very early stream, no JSON shape yet).
          // Skip silently — we'll emit on the next chunk.
        }
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // OpenRouter SSE frames: lines starting with "data: ", blank
          // lines as terminators, sentinel "[DONE]" when finished.
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const payload = trimmed.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            try {
              const json = JSON.parse(payload) as {
                choices?: Array<{
                  delta?: { content?: string };
                }>;
              };
              const delta = json.choices?.[0]?.delta?.content;
              if (typeof delta === "string" && delta.length > 0) {
                accumulated += delta;
                tryEmitPartial(false);
              }
            } catch {
              // Ignore malformed SSE frames — OpenRouter occasionally
              // sends keepalive comment lines.
            }
          }
        }

        // Final emission, then strict validation + persist.
        tryEmitPartial(true);

        try {
          // Strip optional ```json fences if Sonnet wrapped its reply
          // despite the JSON response format.
          const final = stripCodeFence(accumulated);
          const finalJson = JSON.parse(final) as unknown;
          const validated = buildResumeDocFromAI(finalJson, sourceVersion);
          const written = await writeResumeDoc(bucket, handle, validated);
          controller.enqueue(sse({ type: "done", doc: written }));
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

export type ResumeDocStreamPartial = { type: "partial"; doc: ResumeDoc };
export type ResumeDocStreamDone = { type: "done"; doc: ResumeDoc };
export type ResumeDocStreamError = {
  type: "error";
  error: string;
  detail?: string;
};
export type ResumeDocStreamEvent =
  | ResumeDocStreamPartial
  | ResumeDocStreamDone
  | ResumeDocStreamError;
