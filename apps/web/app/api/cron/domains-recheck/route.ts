import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  listActiveForRecheck,
  transitionStatus,
  type CustomDomainRow,
} from "@/lib/domains/repo";
import {
  pollHostnameStatus,
  userFacingSslStatus,
} from "@/lib/domains/cloudflare";
import {
  CNAME_TARGET,
} from "@/lib/domains/security";
import { resolveCnameQuorum } from "@/lib/domains/verifier";

/**
 * Daily re-resolution cron.
 *
 * Scope: every active / provisioning / suspended row whose
 * last_active_check_at is older than 23 hours. We run from a Cloudflare
 * scheduled trigger (or an external cron pinging this URL with a
 * shared bearer secret).
 *
 * Per row:
 *   1. Re-resolve the CNAME via 3-resolver quorum.
 *   2. Poll the CF for SaaS hostname for ssl status drift.
 *   3. Apply state transitions:
 *        active   + DNS broken          → suspended  (notify user)
 *        suspended + DNS came back ok   → active     (notify)
 *        provisioning + ssl active      → active
 *        any + ssl validation_timed_out → failed
 *
 * Authorization: shared bearer secret in the `authorization` header
 * (`Bearer ${CRON_SECRET}`). Without it, returns 401.
 *
 * Scope per run: max 100 hostnames per invocation. The cron should be
 * scheduled hourly so even a 10k-domain account gets covered every
 * ~4 days. (Realistically we recheck active rows once every 24h; 100
 * per hour gives plenty of headroom.)
 */

export const dynamic = "force-dynamic";

const STALE_AFTER_MS = 23 * 60 * 60 * 1000; // 23h
const BATCH = 100;

export async function POST(req: Request) {
  const { env } = await getCloudflareContext({ async: true });
  const auth = req.headers.get("authorization") ?? "";
  if (!env.CRON_SECRET || !auth.startsWith("Bearer ")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const presented = auth.slice(7).trim();
  if (presented !== env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const stale = await listActiveForRecheck(env.DB, STALE_AFTER_MS, BATCH);
  let checked = 0;
  let suspended = 0;
  let reactivated = 0;
  let activated = 0;
  let failed = 0;

  for (const row of stale) {
    checked += 1;
    try {
      const fullRow = await env.DB.prepare(
        `SELECT * FROM custom_domains WHERE id = ?`,
      )
        .bind(row.id)
        .first<CustomDomainRow>();
      if (!fullRow) continue;

      const cfHostname =
        fullRow.is_apex === 1 && fullRow.apex_strategy === "www_redirect"
          ? `www.${fullRow.hostname}`
          : fullRow.hostname;

      const dns = await resolveCnameQuorum(cfHostname, CNAME_TARGET);
      let cfStatus: { status: string; ssl: string } | null = null;
      if (fullRow.cf_custom_hostname_id) {
        cfStatus = await pollHostnameStatus(env, fullRow.cf_custom_hostname_id);
      }

      let nextStatus = fullRow.status;
      let failureReason = fullRow.failure_reason;

      const sslVisible = userFacingSslStatus(cfStatus?.ssl as never);

      if (sslVisible === "failed") {
        nextStatus = "failed";
        failureReason = `cf_ssl_${cfStatus?.ssl ?? "unknown"}`;
        failed += 1;
      } else if (!dns.ok && fullRow.status === "active") {
        nextStatus = "suspended";
        failureReason = "cname_resolution_lost";
        suspended += 1;
      } else if (dns.ok && fullRow.status === "suspended" && sslVisible === "active") {
        nextStatus = "active";
        failureReason = null;
        reactivated += 1;
      } else if (
        dns.ok &&
        sslVisible === "active" &&
        (fullRow.status === "provisioning" || fullRow.status === "verifying")
      ) {
        nextStatus = "active";
        failureReason = null;
        activated += 1;
      }

      await transitionStatus(env.DB, {
        id: row.id,
        userId: row.user_id,
        next: nextStatus,
        prev: fullRow.status,
        cfSslStatus: cfStatus?.ssl ?? null,
        failureReason,
        actor: "system",
        eventType:
          nextStatus === "active" && fullRow.status === "suspended"
            ? "reactivated"
            : nextStatus === "suspended"
              ? "suspended"
              : nextStatus === "failed"
                ? "failed"
                : nextStatus === "active"
                  ? "activated"
                  : "verify_attempt",
        metadata: {
          dnsOk: dns.ok,
          dnsObserved: dns.observed,
          cfStatus,
        },
      });
    } catch {
      // skip — try again next run
    }
  }

  return NextResponse.json({
    checked,
    activated,
    suspended,
    reactivated,
    failed,
    runAt: Date.now(),
  });
}
