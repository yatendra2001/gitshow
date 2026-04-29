/**
 * One-off debug endpoint: dumps the full Cloudflare for SaaS Custom
 * Hostname object for the caller's currently-attached domain. Used
 * during the yatendrakumar.com 522 investigation to see what origin
 * config CF actually has on its side.
 *
 * Auth: Pro session only (same as other /api/domains routes). The
 * response includes only data CF would already return to the user
 * via the dashboard, plus the audit log entries we already store.
 *
 * SAFE TO REMOVE once the 522 issue is rooted out.
 */

import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireProApi } from "@/lib/entitlements";
import { getDomainByUser } from "@/lib/domains/repo";
import { CNAME_TARGET } from "@/lib/domains/security";
import { setCustomOriginSni } from "@/lib/domains/cloudflare";

export const dynamic = "force-dynamic";

/**
 * POST: one-time fix for an existing hostname that was created before
 * we started setting custom_origin_sni on create. PATCHes the live CF
 * for SaaS hostname to set custom_origin_sni = cname.gitshow.io, which
 * breaks the SaaS-pipeline-loop that was causing the 522.
 */
export async function POST() {
  const gate = await requireProApi();
  if (!gate.ok) return gate.response;
  const userId = gate.session.user.id;
  const { env } = await getCloudflareContext({ async: true });

  const row = await getDomainByUser(env.DB, userId);
  if (!row?.cf_custom_hostname_id) {
    return NextResponse.json({ error: "no_cf_id" }, { status: 400 });
  }
  try {
    const updated = await setCustomOriginSni(
      env,
      row.cf_custom_hostname_id,
      CNAME_TARGET,
    );
    return NextResponse.json({ ok: true, updated });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

export async function GET() {
  const gate = await requireProApi();
  if (!gate.ok) return gate.response;
  const userId = gate.session.user.id;
  const { env } = await getCloudflareContext({ async: true });

  const row = await getDomainByUser(env.DB, userId);
  if (!row) return NextResponse.json({ error: "no_domain" }, { status: 404 });
  if (!row.cf_custom_hostname_id) {
    return NextResponse.json({ error: "no_cf_id", row }, { status: 400 });
  }

  const zoneId = env.CF_FOR_SAAS_ZONE_ID;
  const token = env.CF_FOR_SAAS_API_TOKEN;
  if (!zoneId || !token) {
    return NextResponse.json({ error: "missing_secrets" }, { status: 503 });
  }

  // Fetch the full hostname object from CF. No filtering — the dashboard
  // already shows this.
  const cfRes = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${zoneId}/custom_hostnames/${row.cf_custom_hostname_id}`,
    {
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
    },
  );
  const cfBody = await cfRes.json().catch(() => null);

  // Also fetch the zone's fallback origin config.
  const fbRes = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${zoneId}/custom_hostnames/fallback_origin`,
    {
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
    },
  );
  const fbBody = await fbRes.json().catch(() => null);

  return NextResponse.json({
    domain_row: {
      id: row.id,
      hostname: row.hostname,
      status: row.status,
      cf_custom_hostname_id: row.cf_custom_hostname_id,
      cf_ssl_status: row.cf_ssl_status,
      apex_strategy: row.apex_strategy,
      failure_reason: row.failure_reason,
    },
    cf_custom_hostname: cfBody,
    cf_fallback_origin: fbBody,
    queried_at: new Date().toISOString(),
  });
}
