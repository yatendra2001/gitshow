import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireProApi } from "@/lib/entitlements";
import {
  loadDraftWithEvent,
  updateDraftContent,
  updateDraftStatus,
} from "@/lib/bip-data";
import type { DraftBlob } from "@/lib/bip-ai";

/**
 * /api/build/drafts/[id]
 *
 *   PATCH  { content?: DraftBlob, status?: 'draft'|'dismissed'|'posted',
 *            markedPostedPlatforms?: string }
 *   GET    → { draft, event, content }
 */

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const parsed = parseId(id);
  if (parsed === null) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 });
  }
  const gate = await requireProApi();
  if (!gate.ok) return gate.response;
  const userId = gate.session.user.id;
  const { env } = await getCloudflareContext({ async: true });
  const row = await loadDraftWithEvent(env.DB, userId, parsed);
  if (!row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({
    draft: row.draft,
    event: row.event,
    content: row.content,
  });
}

interface PatchBody {
  content?: DraftBlob;
  status?: "draft" | "dismissed" | "posted";
  markedPostedPlatforms?: string | null;
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const parsed = parseId(id);
  if (parsed === null) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 });
  }
  const gate = await requireProApi();
  if (!gate.ok) return gate.response;
  const userId = gate.session.user.id;
  const { env } = await getCloudflareContext({ async: true });
  const row = await loadDraftWithEvent(env.DB, userId, parsed);
  if (!row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (body.content) {
    await updateDraftContent(env.DB, userId, parsed, sanitizeDraft(body.content));
  }
  if (body.status) {
    if (!["draft", "dismissed", "posted"].includes(body.status)) {
      return NextResponse.json({ error: "bad_status" }, { status: 400 });
    }
    await updateDraftStatus(
      env.DB,
      userId,
      parsed,
      body.status,
      body.markedPostedPlatforms ?? null,
    );
  }

  const updated = await loadDraftWithEvent(env.DB, userId, parsed);
  return NextResponse.json({
    ok: true,
    draft: updated?.draft ?? null,
    event: updated?.event ?? null,
    content: updated?.content ?? null,
  });
}

function parseId(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function sanitizeDraft(blob: DraftBlob): DraftBlob {
  const out: DraftBlob = {};
  if (Array.isArray(blob.x_thread)) {
    out.x_thread = blob.x_thread
      .filter((t): t is string => typeof t === "string")
      .map((t) => t.slice(0, 1000))
      .slice(0, 12);
  }
  if (typeof blob.linkedin === "string") {
    out.linkedin = blob.linkedin.slice(0, 3500);
  }
  if (blob.blog && typeof blob.blog === "object") {
    const b = blob.blog as { title?: unknown; body_md?: unknown };
    if (typeof b.title === "string" && typeof b.body_md === "string") {
      out.blog = {
        title: b.title.slice(0, 200),
        body_md: b.body_md.slice(0, 8000),
      };
    }
  }
  return out;
}
