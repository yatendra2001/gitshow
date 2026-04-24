import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireProApi } from "@/lib/entitlements";
import {
  draftResumeKey,
  publishedResumeKey,
} from "@/lib/resume-io";

/**
 * POST /api/profile/publish-resume — promote the signed-in user's
 * `resumes/{handle}/draft.json` to `resumes/{handle}/published.json`.
 *
 * This is a testing convenience until the full editor + Publish UI ships
 * in Phase 4. Right now the resume pipeline writes only `draft.json`;
 * `/{handle}` renders `published.json`; a user who just finished a scan
 * has no UI to promote one to the other.
 *
 * Auth: the session's user.login is used as the handle — the route does
 * NOT accept a handle in the request, preventing one user from
 * publishing another user's draft.
 *
 * Atomicity: R2 has no native copy primitive; we GET → PUT. For a
 * 20-200 KB Resume JSON this completes in well under a second, and a
 * partial failure leaves the previous published.json in place (we only
 * PUT on successful GET).
 */
export async function POST() {
  // Pro-gated: publishing a draft is a Pro edit operation. The public
  // page itself stays live forever once published — this gate only
  // controls who can CREATE/UPDATE that public artifact.
  const gate = await requireProApi();
  if (!gate.ok) return gate.response;
  const session = gate.session;
  if (!session.user.login) {
    return NextResponse.json({ error: "no_handle" }, { status: 400 });
  }

  const { env } = await getCloudflareContext({ async: true });
  if (!env.BUCKET) {
    return NextResponse.json(
      { error: "r2_not_bound" },
      { status: 500 },
    );
  }

  const handle = session.user.login;
  const draftKey = draftResumeKey(handle);
  const publishedKey = publishedResumeKey(handle);

  const draft = await env.BUCKET.get(draftKey);
  if (!draft) {
    return NextResponse.json(
      {
        error: "no_draft",
        detail: `No draft resume found at ${draftKey}. Run a scan first.`,
      },
      { status: 404 },
    );
  }

  const body = await draft.text();
  try {
    await env.BUCKET.put(publishedKey, body, {
      httpMetadata: { contentType: "application/json" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: "r2_write", detail: (err as Error).message.slice(0, 200) },
      { status: 500 },
    );
  }

  // Also upsert a user_profiles row so the public `/{handle}` route's
  // reserved-word check (and the dashboard's state lookup) agree this
  // user has a published profile. We use the same slug normalization
  // the claim publish endpoint uses.
  const slug = handle.toLowerCase();
  const now = Date.now();
  try {
    await env.DB.prepare(
      `INSERT INTO user_profiles
         (user_id, handle, public_slug, current_scan_id, current_profile_r2_key,
          first_scan_at, last_scan_at, revision_count, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?, 0, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         handle = excluded.handle,
         public_slug = excluded.public_slug,
         current_profile_r2_key = excluded.current_profile_r2_key,
         last_scan_at = excluded.last_scan_at,
         updated_at = excluded.updated_at`,
    )
      .bind(session.user.id, handle, slug, publishedKey, now, now, now, now)
      .run();
  } catch (err) {
    // Best-effort — the publish already succeeded at the R2 level. Log
    // the DB error but don't fail the request.
    console.error("publish-resume db upsert failed:", err);
  }

  return NextResponse.json({
    ok: true,
    handle,
    slug,
    publishedKey,
    url: `/${handle}`,
  });
}
