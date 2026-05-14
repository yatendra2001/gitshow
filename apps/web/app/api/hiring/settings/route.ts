import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireProApi } from "@/lib/entitlements";
import {
  getDiscoverable,
  loadOpenToWorkSettings,
  setDiscoverable,
  upsertOpenToWorkSettings,
} from "@/lib/bip-data";

/**
 * /api/hiring/settings
 *
 *   GET   → { settings, discoverable }
 *   POST  → upsert settings (any subset of fields) and/or discoverable
 *
 * `discoverable` is the master switch — when false the portfolio
 * never renders the "open to" badge or contact form regardless of
 * what's stored in open_to_work_settings.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireProApi();
  if (!gate.ok) return gate.response;
  const userId = gate.session.user.id;
  const { env } = await getCloudflareContext({ async: true });
  const [settings, discoverable] = await Promise.all([
    loadOpenToWorkSettings(env.DB, userId),
    getDiscoverable(env.DB, userId),
  ]);
  return NextResponse.json({ settings, discoverable });
}

interface PostBody {
  discoverable?: boolean;
  status?: "looking" | "selectively" | "not_looking";
  roles?: string | null;
  locations?: string | null;
  comp_min_usd?: number | null;
  comp_max_usd?: number | null;
  blurb?: string | null;
  contact_email?: string | null;
  show_comp?: boolean;
}

export async function POST(req: Request) {
  const gate = await requireProApi();
  if (!gate.ok) return gate.response;
  const userId = gate.session.user.id;

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { env } = await getCloudflareContext({ async: true });

  if (typeof body.discoverable === "boolean") {
    await setDiscoverable(env.DB, userId, body.discoverable);
  }

  const patch: Parameters<typeof upsertOpenToWorkSettings>[2] = {};
  if (body.status && ["looking", "selectively", "not_looking"].includes(body.status)) {
    patch.status = body.status;
  }
  if ("roles" in body) patch.roles = trimOrNull(body.roles, 240);
  if ("locations" in body) patch.locations = trimOrNull(body.locations, 240);
  if ("comp_min_usd" in body) patch.comp_min_usd = clampUsd(body.comp_min_usd);
  if ("comp_max_usd" in body) patch.comp_max_usd = clampUsd(body.comp_max_usd);
  if ("blurb" in body) patch.blurb = trimOrNull(body.blurb, 600);
  if ("contact_email" in body) patch.contact_email = trimOrNull(body.contact_email, 200);
  if (typeof body.show_comp === "boolean") patch.show_comp = body.show_comp;

  const settings = await upsertOpenToWorkSettings(env.DB, userId, patch);
  const discoverable = await getDiscoverable(env.DB, userId);
  return NextResponse.json({ ok: true, settings, discoverable });
}

function trimOrNull(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (t.length === 0) return null;
  return t.slice(0, max);
}

function clampUsd(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(0, Math.min(10_000_000, Math.round(n)));
}
