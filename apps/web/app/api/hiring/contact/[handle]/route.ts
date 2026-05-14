import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  insertRecruiterInbound,
  loadOpenToWorkSettings,
  loadPublicHiringByHandle,
  tryConsumeContactBucket,
} from "@/lib/bip-data";
import { triageRecruiterInbound } from "@/lib/bip-ai";
import { clientIp } from "@/lib/visitor";
import { siteConfig } from "@/lib/marketing-config";

/**
 * POST /api/hiring/contact/[handle] — public recruiter contact form.
 *
 * No auth required (it's a public form on a portfolio). We:
 *   1. Resolve handle → user_id, refuse if not discoverable or "not_looking"
 *   2. Rate-limit per (user_id, source_ip)
 *   3. Insert a row in recruiter_inbound
 *   4. Asynchronously triage with the LLM, persist the scores
 *
 * Triage is *inline* but wrapped in try/catch — a triage failure
 * doesn't lose the message. The inbox sorts by fit_score so an untriaged
 * row (default fit 50) still surfaces, just not at the top.
 */

export const dynamic = "force-dynamic";

interface ContactBody {
  from_name?: string;
  from_email?: string;
  from_company?: string | null;
  from_role?: string | null;
  role_title?: string | null;
  role_link?: string | null;
  comp_note?: string | null;
  location_note?: string | null;
  body?: string;
}

const EMAIL_RX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function POST(
  req: Request,
  ctx: { params: Promise<{ handle: string }> },
) {
  const { handle } = await ctx.params;
  if (!handle || handle.length > 80) {
    return NextResponse.json({ error: "bad_handle" }, { status: 400 });
  }

  const { env } = await getCloudflareContext({ async: true });
  const target = await loadPublicHiringByHandle(env.DB, handle);
  if (!target) {
    return NextResponse.json(
      { error: "not_open", message: "This developer isn't accepting inbound right now." },
      { status: 404 },
    );
  }

  const ip = clientIp(req);
  const ok = await tryConsumeContactBucket(env.DB, target.userId, ip);
  if (!ok) {
    return NextResponse.json(
      {
        error: "rate_limited",
        message: "Too many messages from your IP. Try again in an hour.",
      },
      { status: 429 },
    );
  }

  let body: ContactBody;
  try {
    body = (await req.json()) as ContactBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const fromName = trim(body.from_name, 200);
  const fromEmail = trim(body.from_email, 200);
  const messageBody = trim(body.body, 6000);
  if (!fromName || fromName.length < 2) {
    return NextResponse.json({ error: "missing_name" }, { status: 422 });
  }
  if (!fromEmail || !EMAIL_RX.test(fromEmail)) {
    return NextResponse.json({ error: "missing_email" }, { status: 422 });
  }
  if (!messageBody || messageBody.length < 40) {
    return NextResponse.json(
      { error: "too_short", message: "Add a few sentences about the role." },
      { status: 422 },
    );
  }

  const triageInput = {
    fromName,
    fromEmail,
    fromCompany: trimOrNull(body.from_company, 200),
    roleTitle: trimOrNull(body.role_title, 200),
    roleLink: trimOrNull(body.role_link, 800),
    compNote: trimOrNull(body.comp_note, 200),
    locationNote: trimOrNull(body.location_note, 200),
    body: messageBody,
  };

  // Triage best-effort; doesn't gate the insert.
  const settings = await loadOpenToWorkSettings(env.DB, target.userId);
  const apiKey = process.env.OPENROUTER_API_KEY;
  const triage = apiKey
    ? await triageRecruiterInbound(
        triageInput,
        {
          openToWorkBlurb: settings.blurb,
          desiredRoles: settings.roles,
          desiredLocations: settings.locations,
          compMinUsd: settings.comp_min_usd,
          compMaxUsd: settings.comp_max_usd,
        },
        { apiKey, appUrl: siteConfig.url },
      )
    : { fitScore: 50, spamScore: 0, fitReason: "Triage unavailable" };

  // High spam score → auto-flag as spam (still saved for audit).
  const status = triage.spamScore >= 70 ? "spam" : "new";
  const sourceHostname = req.headers.get("host") ?? null;
  const sourceUa = req.headers.get("user-agent") ?? null;

  await insertRecruiterInbound(env.DB, target.userId, {
    from_name: fromName,
    from_email: fromEmail,
    from_company: triageInput.fromCompany,
    from_role: trimOrNull(body.from_role, 200),
    role_title: triageInput.roleTitle,
    role_link: triageInput.roleLink,
    comp_note: triageInput.compNote,
    location_note: triageInput.locationNote,
    body: messageBody,
    spam_score: triage.spamScore,
    fit_score: triage.fitScore,
    fit_reason: triage.fitReason,
    status,
    source_hostname: sourceHostname,
    source_ip: ip,
    source_ua: sourceUa,
    created_at: Date.now(),
  });

  return NextResponse.json({ ok: true });
}

function trim(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}
function trimOrNull(v: unknown, max: number): string | null {
  const t = trim(v, max);
  return t.length > 0 ? t : null;
}
