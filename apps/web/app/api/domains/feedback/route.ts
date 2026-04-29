import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireProApi } from "@/lib/entitlements";
import { recordFeedback } from "@/lib/domains/gemini";
import { PROVIDERS, type ProviderId } from "@/lib/domains/providers";

/**
 * POST /api/domains/feedback — "Were these steps helpful?"
 *
 * Bumps helpful_count / unhelpful_count on the cached Gemini entry.
 * Used to detect drift in AI-generated instructions and to graduate
 * popular providers into the curated tier.
 */

export const dynamic = "force-dynamic";

interface FeedbackBody {
  provider?: string;
  kind?: string;
  helpful?: boolean;
}

export async function POST(req: Request) {
  const gate = await requireProApi();
  if (!gate.ok) return gate.response;
  const { env } = await getCloudflareContext({ async: true });
  let body: FeedbackBody;
  try {
    body = (await req.json()) as FeedbackBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const provider = (body.provider ?? "") as ProviderId;
  if (!(provider in PROVIDERS)) {
    return NextResponse.json({ error: "bad_provider" }, { status: 400 });
  }
  const kind = String(body.kind ?? "");
  const ALLOWED = new Set([
    "cname_subdomain",
    "cname_apex_flatten",
    "apex_alias",
    "apex_url_forward",
    "txt_verify",
  ]);
  if (!ALLOWED.has(kind)) {
    return NextResponse.json({ error: "bad_kind" }, { status: 400 });
  }
  await recordFeedback(env.DB, PROVIDERS[provider].label, kind, body.helpful === true);
  return NextResponse.json({ ok: true });
}
