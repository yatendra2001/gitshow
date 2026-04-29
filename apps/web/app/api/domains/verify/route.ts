import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireProApi } from "@/lib/entitlements";
import {
  bucketKey,
  checkRateLimit,
  CNAME_TARGET,
  RATE_LIMITS,
} from "@/lib/domains/security";
import {
  getDomainByUser,
  transitionStatus,
  type CustomDomainRow,
} from "@/lib/domains/repo";
import {
  createCustomHostname,
  CFForSaasError,
  pollHostnameStatus,
  userFacingSslStatus,
} from "@/lib/domains/cloudflare";
import {
  checkApexRedirect,
  resolveCnameQuorum,
  resolveTxtQuorum,
} from "@/lib/domains/verifier";
import { clientIp } from "@/lib/visitor";

/**
 * POST /api/domains/verify — kick off / re-poll verification.
 *
 * Verification has two phases that this endpoint walks through
 * idempotently — calling it again is safe and just advances the state
 * if more checks have passed since last call:
 *
 *   PHASE 1 (DNS):  user has set up the CNAME / ALIAS / www-redirect.
 *     We query 3 DoH resolvers and require quorum.
 *
 *   PHASE 2 (CF for SaaS):  if not already created, register the
 *     hostname with CF (this triggers their pre-validation TXT + cert
 *     issuance via HTTP DCV through the user's CNAME). Then poll
 *     `getCustomHostname` for ssl.status. Active = we activate.
 *
 * Each call:
 *   - Increments verify rate limit (12/hr).
 *   - Records `verify_attempt` audit row.
 *   - Returns the current full state for the UI to render the timeline.
 */

export const dynamic = "force-dynamic";

interface VerifyResponse {
  status: CustomDomainRow["status"];
  dns: { ok: boolean; observed: string[] };
  apexRedirect?: { ok: boolean; status: number; location: string | null } | null;
  cf: {
    customHostnameId: string | null;
    sslStatus: string | null;
    userVisible: "provisioning" | "active" | "failed";
    txtName?: string;
    txtValue?: string;
  } | null;
  failureReason: string | null;
  cnameTarget: string;
  hostname: string;
  isApex: boolean;
  apexStrategy: string | null;
}

export async function POST(req: Request) {
  const gate = await requireProApi();
  if (!gate.ok) return gate.response;
  const userId = gate.session.user.id;
  const ua = req.headers.get("user-agent");
  const ip = clientIp(req);
  const { env } = await getCloudflareContext({ async: true });

  const rl = await checkRateLimit(
    env.DB,
    bucketKey("verify", userId),
    RATE_LIMITS.verify.limit,
    RATE_LIMITS.verify.windowSec,
  );
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited", retryAfter: rl.retryAfterSec },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } },
    );
  }

  const row = await getDomainByUser(env.DB, userId);
  if (!row) {
    return NextResponse.json(
      { error: "no_domain", message: "Add a domain first." },
      { status: 404 },
    );
  }

  // ─── Phase 1: DNS quorum ────────────────────────────────────────
  // For subdomain or apex-flatten / apex-alias: check CNAME/A on the
  // hostname itself. For www_redirect: check CNAME on www.{hostname}
  // AND that the apex returns a 301/302 to www.
  let dnsOk = false;
  let dnsObserved: string[] = [];
  let apexRedirectResult: { ok: boolean; status: number; location: string | null } | null = null;

  if (row.is_apex && row.apex_strategy === "www_redirect") {
    const wwwHost = `www.${row.hostname}`;
    const [wwwQ, redir] = await Promise.all([
      resolveCnameQuorum(wwwHost, CNAME_TARGET),
      checkApexRedirect(row.hostname),
    ]);
    dnsOk = wwwQ.ok; // www CNAME must resolve; redirect is informational pre-active
    dnsObserved = wwwQ.observed;
    apexRedirectResult = redir;
  } else {
    const q = await resolveCnameQuorum(row.hostname, CNAME_TARGET);
    dnsOk = q.ok;
    dnsObserved = q.observed;
  }

  // ─── Phase 2: CF for SaaS ───────────────────────────────────────
  // If DNS is ok and we haven't created the CF custom hostname yet,
  // create it. If already created, just poll status. If DNS isn't ok,
  // we skip the CF call entirely — CF would 422 us anyway, no point
  // wasting a request.
  let cfId = row.cf_custom_hostname_id;
  let sslStatus = row.cf_ssl_status;
  let cfTxtName: string | undefined;
  let cfTxtValue: string | undefined;
  let nextStatus: CustomDomainRow["status"] = row.status;
  let failureReason: string | null = row.failure_reason;
  let createError: string | null = null;

  // The CF hostname we register: for www_redirect, register `www.{host}`
  // (that's where the cert lives); for everything else, register the
  // hostname directly.
  const cfHostname =
    row.is_apex && row.apex_strategy === "www_redirect"
      ? `www.${row.hostname}`
      : row.hostname;

  if (dnsOk && !cfId) {
    try {
      const ch = await createCustomHostname(env, {
        hostname: cfHostname,
        customMetadata: {
          userId,
          domainId: row.id,
        },
        ownershipMethod: "txt",
      });
      cfId = ch.id;
      sslStatus = ch.ssl.status;
      cfTxtName = ch.ownership_verification?.name ?? ch.ssl.txt_name;
      cfTxtValue = ch.ownership_verification?.value ?? ch.ssl.txt_value;
      nextStatus = "provisioning";
    } catch (err) {
      if (err instanceof CFForSaasError) {
        createError = err.message;
        // Most common transient: 1414 "duplicate hostname". That happens
        // if a previous attempt half-succeeded. Treat as recoverable —
        // we'll see it on next poll once CF GCs.
        if (err.errors.some((e) => e.code === 1414 || e.code === 1419)) {
          nextStatus = "verifying";
          failureReason = "duplicate_hostname_pending_cleanup";
        } else {
          nextStatus = "failed";
          failureReason = `cf_${err.code}: ${err.message}`;
        }
      } else {
        nextStatus = "failed";
        failureReason = "cf_unknown_error";
      }
    }
  } else if (cfId) {
    // Poll for status updates.
    try {
      const status = await pollHostnameStatus(env, cfId);
      if (status) {
        sslStatus = status.ssl;
        const userVisible = userFacingSslStatus(status.ssl);
        if (userVisible === "active") nextStatus = "active";
        else if (userVisible === "failed") nextStatus = "failed";
        else nextStatus = dnsOk ? "provisioning" : "verifying";
      }
    } catch (err) {
      if (err instanceof CFForSaasError) {
        createError = err.message;
      }
    }
  } else if (!dnsOk) {
    // DNS still not visible — stay verifying.
    nextStatus = "verifying";
  }

  // For apex www_redirect, even if DNS + SSL are good, we want the
  // apex 301 to be in place before flipping to "active" — otherwise
  // typing the bare domain looks broken.
  if (
    nextStatus === "active" &&
    row.is_apex &&
    row.apex_strategy === "www_redirect" &&
    !(apexRedirectResult?.ok)
  ) {
    nextStatus = "provisioning";
    failureReason = "apex_redirect_missing";
  }

  if (nextStatus !== row.status || sslStatus !== row.cf_ssl_status || cfId !== row.cf_custom_hostname_id) {
    await transitionStatus(env.DB, {
      id: row.id,
      userId,
      next: nextStatus,
      prev: row.status,
      cfId: cfId ?? null,
      cfSslStatus: sslStatus ?? null,
      cfSslMethod: cfId && !row.cf_ssl_method ? "http" : null,
      failureReason,
      actor: "user",
      eventType:
        nextStatus === "active"
          ? "activated"
          : nextStatus === "failed"
            ? "failed"
            : nextStatus === "provisioning"
              ? "dns_verified"
              : "verify_attempt",
      ip,
      userAgent: ua,
      metadata: {
        dnsOk,
        dnsObserved,
        apexRedirect: apexRedirectResult,
        cfError: createError,
      },
    });
  } else {
    // No state change — still record a verify_attempt for the audit log
    // (helps support diagnose "I clicked verify 50 times" cases).
    await transitionStatus(env.DB, {
      id: row.id,
      userId,
      next: row.status,
      prev: row.status,
      cfSslStatus: sslStatus ?? null,
      failureReason,
      actor: "user",
      eventType: "verify_attempt",
      ip,
      userAgent: ua,
      metadata: { dnsOk, dnsObserved, apexRedirect: apexRedirectResult },
    });
  }

  const body: VerifyResponse = {
    status: nextStatus,
    dns: { ok: dnsOk, observed: dnsObserved },
    apexRedirect: apexRedirectResult,
    cf: cfId
      ? {
          customHostnameId: cfId,
          sslStatus: sslStatus,
          userVisible: userFacingSslStatus(sslStatus as never),
          txtName: cfTxtName,
          txtValue: cfTxtValue,
        }
      : null,
    failureReason,
    cnameTarget: CNAME_TARGET,
    hostname: row.hostname,
    isApex: row.is_apex === 1,
    apexStrategy: row.apex_strategy,
  };
  return NextResponse.json(body);
}
