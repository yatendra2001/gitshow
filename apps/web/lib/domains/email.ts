/**
 * Domain-live notification email.
 *
 * Sent once when a custom domain transitions to `active`. Quiet,
 * confident, single CTA — modeled on Vercel/Linear's transactional
 * emails. System font stack, monospace for the hostname, a single
 * primary button. No marketing fluff, no dark-pattern unsubscribe
 * footer (transactional notification, not marketing).
 *
 * Delivery: best-effort via Resend. If RESEND_API_KEY is missing we
 * skip silently — the in-dashboard timeline is the source of truth
 * for "your domain is live", the email is just a courtesy.
 *
 * Idempotency lives at the call site (see notifyDomainActivated): we
 * only fire when prev_status !== 'active' && next_status === 'active'.
 */

import type { D1Database } from "@cloudflare/workers-types";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_FROM = "Yatendra (gitshow) <yatendra@gitshow.io>";
const FALLBACK_FROM = "onboarding@resend.dev";

export interface DomainLiveEmailParams {
  to: string;
  hostname: string;
  /** Public slug for the dashboard link. */
  slug: string;
  /** Optional first-name for personalized salutation. */
  firstName?: string | null;
  /** App URL for "manage in dashboard". Defaults to https://gitshow.io. */
  appUrl?: string;
}

/**
 * Fire the email. Returns true if Resend accepted it, false on any
 * failure (including no API key). Never throws — caller-safe to
 * fire-and-forget.
 */
export async function sendDomainLiveEmail(
  env: CloudflareEnv,
  params: DomainLiveEmailParams,
): Promise<boolean> {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) return false;

  const appUrl = (params.appUrl ?? env.NEXT_PUBLIC_APP_URL ?? "https://gitshow.io").replace(/\/$/, "");
  const subject = `${params.hostname} is live`;
  const html = renderHtml({
    hostname: params.hostname,
    slug: params.slug,
    firstName: params.firstName ?? null,
    appUrl,
  });
  const text = renderText({
    hostname: params.hostname,
    slug: params.slug,
    appUrl,
  });

  // Primary attempt with our verified sender, fall back to Resend's
  // sandbox if the domain isn't verified (403/422). Same pattern as
  // packages/shared/src/notifications/email.ts.
  const from = env.EMAIL_FROM ?? DEFAULT_FROM;
  const first = await postResend(apiKey, {
    from,
    to: [params.to],
    subject,
    html,
    text,
    tags: [
      { name: "kind", value: "domain_live" },
      { name: "hostname", value: params.hostname.slice(0, 50) },
    ],
  });
  if (first.ok) return true;

  if ((first.status === 403 || first.status === 422) && from !== FALLBACK_FROM) {
    const retry = await postResend(apiKey, {
      from: FALLBACK_FROM,
      to: [params.to],
      subject,
      html,
      text,
      tags: [
        { name: "kind", value: "domain_live" },
        { name: "fallback", value: "1" },
      ],
    });
    return retry.ok;
  }
  return false;
}

interface ResendBody {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  tags?: Array<{ name: string; value: string }>;
}

async function postResend(
  apiKey: string,
  body: ResendBody,
): Promise<{ ok: boolean; status?: number }> {
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false };
  }
}

// ─── HTML template ─────────────────────────────────────────────────────

interface RenderInput {
  hostname: string;
  slug: string;
  firstName: string | null;
  appUrl: string;
}

function renderHtml(input: RenderInput): string {
  const safeHost = escapeHtml(input.hostname);
  const liveUrl = `https://${input.hostname}`;
  const dashUrl = `${input.appUrl}/app/domain`;
  const greeting = input.firstName
    ? `Hey ${escapeHtml(input.firstName)},`
    : "Hey,";

  // System-font stack, generous whitespace, single CTA, OKLCH-ish
  // neutrals translated to hex for email-client compatibility (a
  // surprising number of clients still don't grok oklch()).
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="x-apple-disable-message-reformatting" />
  <meta name="color-scheme" content="light dark" />
  <meta name="supported-color-schemes" content="light dark" />
  <title>${safeHost} is live</title>
  <style>
    @media (prefers-color-scheme: dark) {
      .gs-bg { background-color: #0c0c0c !important; }
      .gs-card { background-color: #161616 !important; border-color: #262626 !important; }
      .gs-text { color: #e6e6e6 !important; }
      .gs-muted { color: #8c8c8c !important; }
      .gs-mono-card { background-color: #1f1f1f !important; border-color: #2a2a2a !important; color: #f0f0f0 !important; }
      .gs-cta { background-color: #ffffff !important; color: #0c0c0c !important; }
      .gs-divider { border-color: #262626 !important; }
      .gs-link { color: #d4d4d4 !important; }
    }
  </style>
</head>
<body class="gs-bg" style="margin:0;padding:32px 16px;background-color:#fafafa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="520" style="max-width:520px;width:100%;border-collapse:collapse;">
          <!-- Brand row -->
          <tr>
            <td style="padding:0 4px 20px;">
              <span class="gs-text" style="font-size:13px;font-weight:600;letter-spacing:-0.01em;color:#0c0c0c;">gitshow</span>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td class="gs-card" style="background-color:#ffffff;border:1px solid #ececec;border-radius:14px;padding:32px;">
              <!-- Status pill -->
              <p style="margin:0 0 18px;">
                <span style="display:inline-block;padding:4px 10px;border-radius:999px;background-color:#ecfdf5;color:#047857;font-size:11px;font-weight:600;letter-spacing:0.02em;text-transform:uppercase;">
                  Live
                </span>
              </p>

              <h1 class="gs-text" style="margin:0 0 12px;font-size:22px;line-height:1.25;font-weight:600;letter-spacing:-0.02em;color:#0c0c0c;">
                Your domain is live.
              </h1>
              <p class="gs-muted" style="margin:0 0 24px;font-size:14px;line-height:1.55;color:#525252;">
                ${greeting} your portfolio is now served from your own domain. Anyone visiting it gets your work over a secure connection — no setup left to do.
              </p>

              <!-- Hostname card -->
              <div class="gs-mono-card" style="background-color:#fafafa;border:1px solid #ececec;border-radius:10px;padding:14px 16px;margin:0 0 24px;">
                <div class="gs-muted" style="font-size:10.5px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#737373;margin:0 0 6px;">
                  Now serving from
                </div>
                <div class="gs-text" style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace;font-size:15px;color:#0c0c0c;word-break:break-all;">
                  ${safeHost}
                </div>
              </div>

              <!-- CTA -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px;">
                <tr>
                  <td>
                    <a class="gs-cta" href="${escapeHtml(liveUrl)}" style="display:inline-block;background-color:#0c0c0c;color:#ffffff;font-size:14px;font-weight:500;letter-spacing:-0.01em;text-decoration:none;padding:11px 22px;border-radius:9px;mso-padding-alt:0;">
                      View your portfolio &nbsp;→
                    </a>
                  </td>
                </tr>
              </table>
              <p class="gs-muted" style="margin:14px 0 0;font-size:12.5px;line-height:1.5;color:#737373;">
                Manage settings in your <a class="gs-link" href="${escapeHtml(dashUrl)}" style="color:#0c0c0c;text-decoration:underline;text-underline-offset:2px;">dashboard</a>. Your old <span style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;">gitshow.io/${escapeHtml(input.slug)}</span> link still works.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 4px 0;">
              <hr class="gs-divider" style="border:none;border-top:1px solid #ececec;margin:0 0 16px;" />
              <p class="gs-muted" style="margin:0;font-size:11.5px;line-height:1.5;color:#a3a3a3;">
                Sent because your gitshow Pro custom domain went live. Quiet by default — we'll only email you for things like this.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function renderText(input: { hostname: string; slug: string; appUrl: string }): string {
  return [
    `Your domain is live.`,
    ``,
    `Your gitshow portfolio is now served from your own domain:`,
    `https://${input.hostname}`,
    ``,
    `Manage settings: ${input.appUrl}/app/domain`,
    `Your old gitshow.io/${input.slug} link still works too.`,
    ``,
    `— gitshow`,
  ].join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ─── Lookup helper (used by the activation hook) ────────────────────

export interface ActivationContext {
  email: string;
  firstName: string | null;
  hostname: string;
  slug: string;
}

export async function loadActivationContext(
  db: D1Database,
  domainId: string,
): Promise<ActivationContext | null> {
  const row = await db
    .prepare(
      `SELECT u.email AS email, u.name AS name,
              cd.hostname AS hostname,
              up.public_slug AS public_slug
         FROM custom_domains cd
         JOIN users u ON u.id = cd.user_id
         LEFT JOIN user_profiles up ON up.user_id = cd.user_id
        WHERE cd.id = ?
        LIMIT 1`,
    )
    .bind(domainId)
    .first<{ email: string | null; name: string | null; hostname: string; public_slug: string | null }>();
  if (!row || !row.email) return null;
  return {
    email: row.email,
    firstName: firstNameFrom(row.name),
    hostname: row.hostname,
    slug: row.public_slug ?? "",
  };
}

function firstNameFrom(name: string | null): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  const first = trimmed.split(/\s+/)[0];
  // Reject tokens that look like emails or usernames; we'd rather no
  // greeting than "Hey hxr+gh@gmail.com,".
  if (!first || first.includes("@") || first.length > 30) return null;
  return first;
}
