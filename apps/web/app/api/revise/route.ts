import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { z } from "zod";
import { FlyClient } from "@gitshow/shared/cloud/fly";
import { auth } from "@/auth";
import { getScanByIdForUser } from "@/lib/scans";
import { getScanCard } from "@/lib/cards";
import {
  classifyRevise,
  describeDispatch,
  type ClassifiedDispatch,
} from "@/lib/classify-revise";

/**
 * POST /api/revise — free-form or targeted.
 *
 * Two request shapes, both fine:
 *
 *   { scanId, guidance }
 *     Free-form. Classify the guidance into one-or-more beats and
 *     dispatch them in parallel. Response lists what we actually
 *     spawned so the chat can render a plain-English summary
 *     ("Rewriting the hook and the disclosure in parallel —
 *     usually 2–6 min.").
 *
 *   { scanId, claimId, guidance }
 *     Explicit target — the user clicked a claim on the artifact or
 *     used an @mention in chat. One beat, one Fly machine.
 *
 * In both paths the worker emits the same progress events, so the
 * right pane tracks the job identically.
 */

const BodySchema = z.object({
  scanId: z.string(),
  claimId: z.string().optional(),
  guidance: z.string().min(1).max(2000),
  /**
   * Optional R2 keys of images the user attached (via /api/revise/upload).
   * The web layer stores them on the message row; the worker reads them
   * when it boots so the revise agent can see the screenshots.
   */
  image_r2_keys: z.array(z.string()).max(5).optional(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const parse = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parse.success) {
    return NextResponse.json(
      { error: "invalid body", issues: parse.error.issues },
      { status: 400 },
    );
  }
  const { scanId, claimId, guidance, image_r2_keys } = parse.data;

  const { env } = await getCloudflareContext({ async: true });
  const scan = await getScanByIdForUser(env.DB, scanId, session.user.id);
  if (!scan) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (scan.status !== "succeeded") {
    return NextResponse.json(
      { error: "scan not succeeded", status: scan.status },
      { status: 409 },
    );
  }

  let dispatches: ClassifiedDispatch[];
  if (claimId) {
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
    dispatches = [
      {
        claimId: claim.id,
        beat: claim.beat as ClassifiedDispatch["beat"],
        guidance,
        reason: "user-targeted",
      },
    ];
  } else {
    const card = await getScanCard(scanId, env.BUCKET);
    if (!card) {
      return NextResponse.json(
        { error: "card_not_ready" },
        { status: 425 },
      );
    }
    dispatches = classifyRevise(guidance, card);
    if (dispatches.length === 0) {
      return NextResponse.json(
        {
          error: "no_match",
          detail:
            "Couldn't figure out what to revise from that message. Try mentioning the hook, numbers, or disclosure.",
        },
        { status: 422 },
      );
    }
  }

  let fly: FlyClient;
  try {
    fly = FlyClient.fromEnv();
  } catch (err) {
    return NextResponse.json(
      { error: "fly_env", detail: (err as Error).message },
      { status: 500 },
    );
  }

  // Create a messages row that scopes all revise events (reasoning
  // deltas, tool cards, sources, revise-applied) so the UI can render
  // inline progress under the user's bubble. All dispatches from this
  // request share the same message_id.
  const messageId = `msg_${Math.random().toString(36).slice(2, 14)}`;
  try {
    await env.DB.prepare(
      `INSERT INTO messages
         (id, user_id, scan_id, kind, body, image_r2_keys, status, created_at, updated_at)
       VALUES (?, ?, ?, 'revise', ?, ?, 'running', ?, ?)`,
    )
      .bind(
        messageId,
        session.user.id,
        scanId,
        guidance,
        image_r2_keys && image_r2_keys.length > 0
          ? JSON.stringify(image_r2_keys)
          : null,
        Date.now(),
        Date.now(),
      )
      .run();
  } catch (err) {
    return NextResponse.json(
      { error: "message_insert", detail: (err as Error).message },
      { status: 500 },
    );
  }

  const ts = Math.floor(Date.now() / 1000);
  const results = await Promise.all(
    dispatches.map(async (d, i) => {
      try {
        const machine = await fly.spawnScanMachine({
          scanId,
          name: `revise-${scanId}-${d.beat}-${ts}-${i}`,
          // WORKDIR inside the image is /app/apps/worker, so the script
          // path is relative to that — NOT "apps/worker/scripts/…".
          initCmd: ["bun", "scripts/revise-claim.ts"],
          env: buildMachineEnv(env, {
            scanId,
            claimId: d.claimId,
            guidance: d.guidance,
            messageId,
            imageKeys: image_r2_keys,
          }),
        });
        return {
          ok: true as const,
          beat: d.beat,
          reason: d.reason,
          machineId: machine.id,
        };
      } catch (err) {
        return {
          ok: false as const,
          beat: d.beat,
          reason: d.reason,
          error: (err as Error).message.slice(0, 200),
        };
      }
    }),
  );
  const succeeded = results.filter((r) => r.ok);
  if (succeeded.length === 0) {
    return NextResponse.json(
      {
        error: "spawn_all_failed",
        detail: results
          .map((r) => (r.ok ? "" : r.error))
          .filter(Boolean)
          .join(" | "),
      },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      message_id: messageId,
      summary: describeDispatch(
        dispatches.filter((d) =>
          results.find((r) => r.ok && r.beat === d.beat),
        ),
      ),
      dispatched: results,
    },
    { status: 202 },
  );
}

function buildMachineEnv(
  env: CloudflareEnv,
  s: {
    scanId: string;
    claimId: string;
    guidance: string;
    messageId: string;
    imageKeys?: string[];
  },
): Record<string, string> {
  const out: Record<string, string> = {
    SCAN_ID: s.scanId,
    CLAIM_ID: s.claimId,
    GUIDANCE: s.guidance,
    MESSAGE_ID: s.messageId,
    GITSHOW_CLOUD_MODE: "1",
    CF_ACCOUNT_ID: required(env, "CF_ACCOUNT_ID"),
    CF_API_TOKEN: required(env, "CF_API_TOKEN"),
    D1_DATABASE_ID: required(env, "D1_DATABASE_ID"),
    R2_BUCKET_NAME: required(env, "R2_BUCKET_NAME"),
    R2_ACCESS_KEY_ID: required(env, "R2_ACCESS_KEY_ID"),
    R2_SECRET_ACCESS_KEY: required(env, "R2_SECRET_ACCESS_KEY"),
    OPENROUTER_API_KEY: required(env, "OPENROUTER_API_KEY"),
  };
  if (s.imageKeys && s.imageKeys.length > 0) {
    out.IMAGE_R2_KEYS = JSON.stringify(s.imageKeys);
  }
  if (env.REALTIME_ENDPOINT) out.REALTIME_ENDPOINT = env.REALTIME_ENDPOINT;
  if (env.PIPELINE_SHARED_SECRET)
    out.PIPELINE_SHARED_SECRET = env.PIPELINE_SHARED_SECRET;
  return out;
}

function required(env: CloudflareEnv, name: string): string {
  const v = (env as unknown as Record<string, string | undefined>)[name];
  if (!v) throw new Error(`missing env: ${name}`);
  return v;
}
