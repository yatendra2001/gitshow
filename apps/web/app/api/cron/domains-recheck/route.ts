import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  listActiveForRecheck,
  transitionStatus,
  type CustomDomainRow,
} from "@/lib/domains/repo";
import {
  CFForSaasError,
  createCustomHostname,
  pollHostnameStatus,
  userFacingSslStatus,
} from "@/lib/domains/cloudflare";
import {
  CNAME_TARGET,
} from "@/lib/domains/security";
import { resolveCnameQuorum } from "@/lib/domains/verifier";
import { notifyDomainActivatedIfTransitioned } from "@/lib/domains/notify";

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
      let cfId = fullRow.cf_custom_hostname_id;

      // If DNS is set up but we never successfully created the CF for
      // SaaS hostname (e.g. previous attempt failed transiently), do
      // it now. Same logic the verify endpoint runs — the cron is the
      // safety net so a stuck row recovers without the user clicking
      // "Check now".
      let cronCfError: string | null = null;
      if (dns.ok && !cfId) {
        try {
          const ch = await createCustomHostname(env, {
            hostname: cfHostname,
            customMetadata: {
              userId: fullRow.user_id,
              domainId: fullRow.id,
            },
            ownershipMethod: "txt",
          });
          cfId = ch.id;
          cfStatus = { status: ch.status, ssl: ch.ssl.status };
        } catch (err) {
          if (err instanceof CFForSaasError) {
            // 1414 = duplicate hostname pending cleanup; transient,
            // try again next cron run.
            if (!err.errors.some((e) => e.code === 1414 || e.code === 1419)) {
              cronCfError = `cf_${err.code}: ${err.message}`.slice(0, 240);
            } else {
              cronCfError = `cf_${err.code}_transient`;
            }
          } else {
            cronCfError = `unknown_error: ${(err as Error).message ?? "no message"}`.slice(0, 240);
          }
          // Surface so we can see it in `wrangler tail` without a redeploy.
          console.warn(
            `[cron-recheck] createCustomHostname failed for ${fullRow.id} (${cfHostname}):`,
            cronCfError,
          );
        }
      } else if (cfId) {
        cfStatus = await pollHostnameStatus(env, cfId);
      }

      let nextStatus = fullRow.status;
      let failureReason = fullRow.failure_reason;

      const sslVisible = userFacingSslStatus(cfStatus?.ssl as never);

      // After a successful create, advance verifying → provisioning so
      // the dashboard shows the right step the next time the user looks.
      if (cfId && !fullRow.cf_custom_hostname_id && fullRow.status === "verifying") {
        nextStatus = "provisioning";
        failureReason = null;
      }

      if (sslVisible === "failed") {
        nextStatus = "failed";
        failureReason = `cf_ssl_${cfStatus?.ssl ?? "unknown"}`;
        failed += 1;
      } else if (cronCfError) {
        // Persist the latest error so it's visible in D1 + the dashboard.
        failureReason = cronCfError;
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
        cfId: cfId ?? null,
        cfSslStatus: cfStatus?.ssl ?? null,
        cfSslMethod: cfId && !fullRow.cf_ssl_method ? "http" : null,
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

      // Fire the activation email when the cron observes a transition
      // into `active` from any non-active state. Same dedupe logic as
      // the verify endpoint (handled inside the helper).
      if (nextStatus === "active" && fullRow.status !== "active") {
        await notifyDomainActivatedIfTransitioned(env, env.DB, {
          domainId: row.id,
          prevStatus: fullRow.status,
          nextStatus,
        });
      }
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
