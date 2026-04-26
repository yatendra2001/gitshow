/**
 * Email notification sender via Resend REST API.
 *
 * Works in both Node.js (Fly worker) and Cloudflare Workers — pure
 * fetch, no native bindings. If RESEND_API_KEY is not set, every call
 * is a graceful no-op. We log but never throw — a failed email must
 * never hurt the pipeline.
 */

import { render } from "@react-email/render";
import type { Logger } from "../util";
import { consoleLogger } from "../util";
import { ScanCompleteEmail } from "./templates/scan-complete";

export interface EmailSenderConfig {
  apiKey: string;
  /** RFC-compliant "Name <addr>" or just "addr". Default: `Yatendra (gitshow) <yatendra@gitshow.io>`. */
  from?: string;
  /**
   * Fallback sender used when `from` is rejected (403/422 — typically
   * unverified domain). `onboarding@resend.dev` is Resend's sandbox
   * sender and needs no domain verification, so it's a safe default.
   * Set to null to disable fallback.
   */
  fallbackFrom?: string | null;
  /** Defaults to https://api.resend.com/emails. */
  endpoint?: string;
  logger?: Logger;
  /** Timeout in ms. Default 5000. */
  timeoutMs?: number;
}

export interface EmailMessage {
  to: string | string[];
  subject: string;
  /** HTML body — Resend renders it. */
  html: string;
  /** Optional plaintext fallback. */
  text?: string;
  /** Optional tags for Resend's analytics (scan_id, kind, etc). */
  tags?: Array<{ name: string; value: string }>;
}

export class ResendSender {
  private apiKey: string;
  private from: string;
  private fallbackFrom: string | null;
  private endpoint: string;
  private timeoutMs: number;
  private log: Logger;

  constructor(cfg: EmailSenderConfig) {
    this.apiKey = cfg.apiKey;
    this.from = cfg.from ?? "Yatendra (gitshow) <yatendra@gitshow.io>";
    this.fallbackFrom =
      cfg.fallbackFrom === undefined ? "onboarding@resend.dev" : cfg.fallbackFrom;
    this.endpoint = cfg.endpoint ?? "https://api.resend.com/emails";
    this.timeoutMs = cfg.timeoutMs ?? 5000;
    this.log = (cfg.logger ?? consoleLogger).child?.({ src: "email" }) ?? cfg.logger ?? consoleLogger;
  }

  /**
   * Construct from env. Returns null if no API key — callers should
   * treat that as "email disabled, skip" rather than failing.
   */
  static fromEnv(opts?: { logger?: Logger }): ResendSender | null {
    const envObj =
      (globalThis as { process?: { env?: Record<string, string | undefined> } })
        .process?.env ?? {};
    const apiKey = envObj.RESEND_API_KEY;
    if (!apiKey) return null;
    return new ResendSender({
      apiKey,
      from: envObj.EMAIL_FROM ?? "Yatendra (gitshow) <yatendra@gitshow.io>",
      fallbackFrom:
        envObj.EMAIL_FALLBACK_FROM === undefined
          ? undefined // use class default
          : envObj.EMAIL_FALLBACK_FROM || null, // "" disables fallback
      logger: opts?.logger,
    });
  }

  async send(
    msg: EmailMessage,
  ): Promise<{ ok: boolean; id?: string; error?: string; from?: string }> {
    const first = await this.attempt(msg, this.from);
    if (first.ok) {
      this.log.info?.(
        { id: first.id, to: msg.to, from: this.from, subject: msg.subject },
        "email.send.ok",
      );
      return { ...first, from: this.from };
    }

    // Domain not verified in Resend returns 403/422. Retry once with the
    // sandbox sender so the user still gets something rather than silence.
    const retryable =
      this.fallbackFrom &&
      this.fallbackFrom !== this.from &&
      (first.status === 403 || first.status === 422);
    if (!retryable) return { ok: false, error: first.error };

    this.log.warn?.(
      { from: this.from, fallbackFrom: this.fallbackFrom, reason: first.error },
      "email.send.falling-back",
    );
    const retry = await this.attempt(msg, this.fallbackFrom!);
    if (retry.ok) {
      this.log.info?.(
        { id: retry.id, to: msg.to, from: this.fallbackFrom, subject: msg.subject },
        "email.send.ok.fallback",
      );
      return { ...retry, from: this.fallbackFrom! };
    }
    return { ok: false, error: retry.error };
  }

  private async attempt(
    msg: EmailMessage,
    from: string,
  ): Promise<{ ok: boolean; id?: string; error?: string; status?: number }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const resp = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: Array.isArray(msg.to) ? msg.to : [msg.to],
          subject: msg.subject,
          html: msg.html,
          ...(msg.text ? { text: msg.text } : {}),
          ...(msg.tags ? { tags: msg.tags } : {}),
        }),
        signal: controller.signal,
      });
      if (!resp.ok) {
        const body = await resp.text();
        this.log.warn?.(
          { status: resp.status, from, body: body.slice(0, 300) },
          "email.send.bad-status",
        );
        return {
          ok: false,
          status: resp.status,
          error: `http ${resp.status}: ${body.slice(0, 200)}`,
        };
      }
      const data = (await resp.json()) as { id?: string };
      return { ok: true, id: data.id };
    } catch (err) {
      this.log.warn?.(
        { err: err instanceof Error ? err.message : String(err), from },
        "email.send.failed",
      );
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      clearTimeout(timer);
    }
  }
}

// ─── Templates ─────────────────────────────────────────────────────
//
// Minimal, text-first HTML. Branded layouts can come later; right now
// the priority is delivery, not design.

export interface ScanCompleteTemplate {
  handle: string;
  profileUrl: string;
}

export async function renderScanComplete(t: ScanCompleteTemplate): Promise<{
  subject: string;
  html: string;
  text: string;
}> {
  const subject = `Your gitshow draft is ready, @${t.handle}`;
  const element = ScanCompleteEmail({
    handle: t.handle,
    profileUrl: t.profileUrl,
    logoUrl: deriveLogoUrl(t.profileUrl),
  });
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);
  return { subject, html, text };
}

function deriveLogoUrl(profileUrl: string): string | undefined {
  try {
    return `${new URL(profileUrl).origin}/icon-light.png`;
  } catch {
    return undefined;
  }
}

export interface ScanFailedTemplate {
  handle: string;
  reason: string;
  dashboardUrl: string;
}

export function renderScanFailed(t: ScanFailedTemplate): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = `Your gitshow scan hit a snag`;
  const text = `Your gitshow scan for @${t.handle} didn't finish. Reason: ${t.reason}

Try again: ${t.dashboardUrl}

— gitshow`;
  const html = layout(
    `<h1 style="font-size:20px;margin:0 0 12px;font-weight:600;">Your gitshow scan hit a snag</h1>
     <p style="margin:0 0 16px;">The scan for <strong>@${escapeHtml(t.handle)}</strong> didn't finish.</p>
     <p style="margin:0 0 16px;color:#333;font-size:13px;background:#fafafa;border:1px solid #eee;border-radius:6px;padding:10px;">${escapeHtml(t.reason)}</p>
     <p style="margin:0 0 24px;"><a href="${escapeHtml(t.dashboardUrl)}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;">Try again</a></p>`,
  );
  return { subject, html, text };
}

export interface AgentQuestionTemplate {
  handle: string;
  stage: string;
  question: string;
  answerUrl: string;
  expiresInMinutes: number;
}

export function renderAgentQuestion(t: AgentQuestionTemplate): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = `gitshow needs your input`;
  const text = `While scanning @${t.handle}, we're stuck on this:

"${t.question}"

Answer at: ${t.answerUrl}

We'll proceed with our best guess in ${t.expiresInMinutes} minutes if you don't get back to us.

— gitshow`;
  const html = layout(
    `<h1 style="font-size:20px;margin:0 0 12px;font-weight:600;">gitshow needs your input</h1>
     <p style="margin:0 0 16px;">We're part-way through scanning <strong>@${escapeHtml(t.handle)}</strong> and hit a fork in the road:</p>
     <blockquote style="margin:0 0 16px;padding:12px 16px;border-left:3px solid #111;background:#fafafa;font-size:14px;">${escapeHtml(t.question)}</blockquote>
     <p style="margin:0 0 24px;"><a href="${escapeHtml(t.answerUrl)}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;">Answer now</a></p>
     <p style="margin:0;color:#666;font-size:13px;">No rush — we'll pick a sensible default in ${t.expiresInMinutes} minutes if you can't get back right away.</p>`,
  );
  return { subject, html, text };
}

// ─── helpers ───────────────────────────────────────────────────────

function layout(inner: string): string {
  return `<!doctype html>
<html>
<body style="margin:0;padding:24px;background:#f5f5f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #eee;border-radius:12px;padding:28px;">
    ${inner}
    <hr style="border:none;border-top:1px solid #eee;margin:28px 0 16px;" />
    <p style="margin:0;color:#999;font-size:12px;">gitshow · your engineering portfolio, in motion.</p>
  </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
