import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { nanoid } from "nanoid";
import { z } from "zod";
import { requireProApi } from "@/lib/entitlements";
import { createIntakeSession } from "@/lib/intake";

/**
 * POST /api/intake — creates a stub intake row and returns its id.
 *
 * Body:  { handle: "yatendra2001" }
 *
 * The intake row exists purely so the URL-collection page has a
 * stable key to POST answers against. No worker is spawned here;
 * the actual scan starts when the user submits URLs to
 * POST /api/intake/[id]/answers.
 */

const BodySchema = z.object({
  handle: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-zA-Z0-9-]+$/, "handle must be a GitHub username"),
});

export async function POST(req: Request) {
  // Pro-gated: the next step (POST /answers) spawns a Fly machine.
  // Re-check here so a non-Pro user doesn't get a usable intakeId.
  const gate = await requireProApi();
  if (!gate.ok) return gate.response;
  const session = gate.session;

  const parse = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parse.success) {
    return NextResponse.json(
      { error: "invalid body", issues: parse.error.issues },
      { status: 400 },
    );
  }

  const { env } = await getCloudflareContext({ async: true });
  const intakeId = `intake-${nanoid(10)}`;

  try {
    await createIntakeSession(env.DB, {
      id: intakeId,
      user_id: session.user.id,
      handle: parse.data.handle,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "db", detail: (err as Error).message },
      { status: 500 },
    );
  }

  return NextResponse.json({ intakeId }, { status: 201 });
}
