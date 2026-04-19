import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { z } from "zod";
import { FlyClient } from "@gitshow/shared/cloud/fly";
import { auth } from "@/auth";
import { getScanByIdForUser } from "@/lib/scans";

/**
 * POST /api/revise — spawn a Fly revise-claim machine.
 *
 * Body: { scanId, claimId, guidance }
 *
 * We validate ownership + claim existence, then spawn a machine with
 * `initCmd: ["bun", "scripts/revise-claim.ts"]` so the same worker
 * image handles both scan + revise. The revise script writes fresh
 * claims back into D1, emits events into scan_events, and the live
 * UI picks up everything via the same channel as a full scan.
 *
 * NB: the worker's revise-claim script currently supports beat in
 * {hook, number, disclosure}. Pattern/shipped revisions are a v1.1 add
 * via a dedicated pattern-reviser — for now those return 501.
 */

const BodySchema = z.object({
  scanId: z.string(),
  claimId: z.string(),
  guidance: z.string().min(1).max(2000),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const parse = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parse.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { scanId, claimId, guidance } = parse.data;

  const { env } = await getCloudflareContext({ async: true });
  const scan = await getScanByIdForUser(env.DB, scanId, session.user.id);
  if (!scan) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (scan.status !== "succeeded") {
    return NextResponse.json(
      { error: "scan not succeeded", status: scan.status },
      { status: 409 },
    );
  }

  const claim = await env.DB.prepare(
    `SELECT id, beat FROM claims WHERE id = ? AND scan_id = ? LIMIT 1`,
  )
    .bind(claimId, scanId)
    .first<{ id: string; beat: string }>();
  if (!claim) {
    return NextResponse.json({ error: "claim_not_found" }, { status: 404 });
  }
  if (
    claim.beat !== "hook" &&
    claim.beat !== "number" &&
    claim.beat !== "disclosure"
  ) {
    return NextResponse.json(
      {
        error: "unsupported_beat",
        detail:
          "Pattern and shipped beats are editable in-place via PATCH /api/claims/[id] for now.",
      },
      { status: 501 },
    );
  }

  // Spawn revise Fly machine. Re-uses the same image as run-scan.ts via
  // an init command override — the Dockerfile CMD is run-scan.ts, and
  // init: { cmd } takes precedence at machine start-time.
  try {
    const fly = FlyClient.fromEnv();
    const ts = Math.floor(Date.now() / 1000);
    const machine = await fly.spawnScanMachine({
      scanId,
      name: `revise-${scanId}-${ts}`,
      initCmd: ["bun", "apps/worker/scripts/revise-claim.ts"],
      env: buildMachineEnv(env, {
        scanId,
        claimId,
        guidance,
      }),
    });
    return NextResponse.json(
      {
        ok: true,
        machineId: machine.id,
      },
      { status: 202 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: "spawn", detail: (err as Error).message },
      { status: 500 },
    );
  }
}

function buildMachineEnv(
  env: CloudflareEnv,
  s: { scanId: string; claimId: string; guidance: string },
): Record<string, string> {
  const out: Record<string, string> = {
    SCAN_ID: s.scanId,
    CLAIM_ID: s.claimId,
    GUIDANCE: s.guidance,
    GITSHOW_CLOUD_MODE: "1",
    CF_ACCOUNT_ID: req(env, "CF_ACCOUNT_ID"),
    CF_API_TOKEN: req(env, "CF_API_TOKEN"),
    D1_DATABASE_ID: req(env, "D1_DATABASE_ID"),
    R2_BUCKET_NAME: req(env, "R2_BUCKET_NAME"),
    R2_ACCESS_KEY_ID: req(env, "R2_ACCESS_KEY_ID"),
    R2_SECRET_ACCESS_KEY: req(env, "R2_SECRET_ACCESS_KEY"),
    OPENROUTER_API_KEY: req(env, "OPENROUTER_API_KEY"),
  };
  if (env.REALTIME_ENDPOINT) out.REALTIME_ENDPOINT = env.REALTIME_ENDPOINT;
  if (env.PIPELINE_SHARED_SECRET)
    out.PIPELINE_SHARED_SECRET = env.PIPELINE_SHARED_SECRET;
  return out;
}

function req(env: CloudflareEnv, name: string): string {
  const v = (env as unknown as Record<string, string | undefined>)[name];
  if (!v) throw new Error(`missing env: ${name}`);
  return v;
}
