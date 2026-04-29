/**
 * Cloudflare for SaaS API client — custom hostname operations only.
 *
 * Surface area we need:
 *   - createCustomHostname  → POST /zones/{zone}/custom_hostnames
 *   - getCustomHostname     → GET  /zones/{zone}/custom_hostnames/{id}
 *   - deleteCustomHostname  → DELETE /zones/{zone}/custom_hostnames/{id}
 *
 * That's it. We don't manage DNS records, fallback origins, or the
 * zone — those are configured once in the CF dashboard.
 *
 * Auth: a scoped API token (`CF_FOR_SAAS_API_TOKEN`) with permission
 * `Custom Hostnames:Edit` on a single zone (`CF_ZONE_ID`). No account-
 * wide perms, no DNS edit, no Workers edit. If this token leaks, the
 * blast radius is "attacker can register custom hostnames on our zone"
 * — they can't pivot to other zones or modify code.
 *
 * SSL strategy: HTTP DCV with Delegated DCV in mind. Customer's CNAME
 * already routes to CF's edge, so CF can serve the ACME HTTP-01
 * challenge directly. Cert is issued by Let's Encrypt by default, with
 * automatic renewal handled by Cloudflare. Zero ACME code on our side.
 *
 * Pre-validation (proves customer owns the domain before we activate
 * routing): we use `txt` for the custom_hostname_status because it's
 * portable across DNS providers — works whether the customer's nameserver
 * is Cloudflare, Route53, GoDaddy, etc. The HTTP method requires the
 * CNAME to already be active, which is a chicken-and-egg problem for
 * apex flows where verification happens before the CNAME goes live.
 */

// CloudflareEnv is a global interface declared in cloudflare-env.d.ts.

// ─── API types — minimum subset we read ────────────────────────────────

export interface CFCustomHostname {
  id: string;
  hostname: string;
  status: CFHostnameStatus;
  ssl: {
    id?: string;
    status: CFSslStatus;
    method: "http" | "txt" | "email";
    type: "dv";
    cname_target?: string;
    cname?: string;
    txt_name?: string;
    txt_value?: string;
    validation_records?: Array<{
      txt_name?: string;
      txt_value?: string;
      http_url?: string;
      http_body?: string;
      emails?: string[];
    }>;
    validation_errors?: Array<{ message: string }>;
    certificates?: Array<{
      issuer: string;
      expires_on: string;
    }>;
  };
  ownership_verification?: {
    type: "txt" | "http";
    name?: string;
    value?: string;
  };
  ownership_verification_http?: {
    http_url?: string;
    http_body?: string;
  };
  custom_metadata?: Record<string, string>;
  created_at?: string;
}

export type CFHostnameStatus =
  | "active"
  | "pending"
  | "active_redeploying"
  | "moved"
  | "pending_deletion"
  | "deleted"
  | "pending_blocked"
  | "pending_migration"
  | "pending_provisioned"
  | "test_pending"
  | "test_active"
  | "test_active_apex"
  | "test_blocked"
  | "test_failed"
  | "provisioned"
  | "blocked";

export type CFSslStatus =
  | "initializing"
  | "pending_validation"
  | "pending_issuance"
  | "pending_deployment"
  | "active"
  | "expired"
  | "validation_timed_out"
  | "issuance_timed_out"
  | "deployment_timed_out"
  | "validation_failed"
  | "issuance_failed"
  | "deleted"
  | "pending_cleanup"
  | "staging_deployment"
  | "staging_active"
  | "deactivating"
  | "inactive"
  | "backup_issued"
  | "holding_deployment"
  | "deployment_failed";

// ─── Client ────────────────────────────────────────────────────────────

export interface CFForSaasConfig {
  zoneId: string;
  apiToken: string;
}

function readConfig(env: Pick<CloudflareEnv, "CF_FOR_SAAS_ZONE_ID" | "CF_FOR_SAAS_API_TOKEN">):
  | CFForSaasConfig
  | null {
  const zoneId = env.CF_FOR_SAAS_ZONE_ID;
  const apiToken = env.CF_FOR_SAAS_API_TOKEN;
  if (!zoneId || !apiToken) return null;
  return { zoneId, apiToken };
}

export class CFForSaasError extends Error {
  readonly code: string;
  readonly status: number;
  readonly errors: Array<{ code: number; message: string }>;
  constructor(
    code: string,
    message: string,
    status: number,
    errors: Array<{ code: number; message: string }> = [],
  ) {
    super(message);
    this.name = "CFForSaasError";
    this.code = code;
    this.status = status;
    this.errors = errors;
  }
}

interface CFEnvelope<T> {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: Array<{ code: number; message: string }>;
  result: T;
}

async function call<T>(
  cfg: CFForSaasConfig,
  init: { method: string; path: string; body?: unknown },
): Promise<T> {
  const url = `https://api.cloudflare.com/client/v4/zones/${cfg.zoneId}${init.path}`;
  const res = await fetch(url, {
    method: init.method,
    headers: {
      "authorization": `Bearer ${cfg.apiToken}`,
      "content-type": "application/json",
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  // CF returns JSON even on 4xx/5xx — parse defensively.
  let payload: CFEnvelope<T> | { errors?: Array<{ code: number; message: string }> };
  try {
    payload = (await res.json()) as CFEnvelope<T>;
  } catch {
    throw new CFForSaasError(
      "non_json_response",
      `Cloudflare returned non-JSON ${res.status}`,
      res.status,
    );
  }
  if (!res.ok || !("success" in payload) || !payload.success) {
    const errors =
      (payload as CFEnvelope<T>).errors ??
      (payload as { errors?: Array<{ code: number; message: string }> }).errors ??
      [];
    const first = errors[0];
    throw new CFForSaasError(
      first?.code ? `cf_${first.code}` : "cf_error",
      first?.message ?? `Cloudflare ${res.status}`,
      res.status,
      errors,
    );
  }
  return (payload as CFEnvelope<T>).result;
}

// ─── Operations ────────────────────────────────────────────────────────

export interface CreateCustomHostnameInput {
  hostname: string;
  /** Mirrored back to us via webhooks / dashboards. We use it for our own user_id. */
  customMetadata?: Record<string, string>;
  /**
   * Pre-validation method. We default to 'txt' so the user can prove
   * ownership before the CNAME is live (matters for apex flows where
   * the CNAME might break the domain mid-setup).
   */
  ownershipMethod?: "txt" | "http";
}

export async function createCustomHostname(
  env: CloudflareEnv,
  input: CreateCustomHostnameInput,
): Promise<CFCustomHostname> {
  const cfg = readConfig(env);
  if (!cfg) {
    throw new CFForSaasError(
      "config_missing",
      "CF_FOR_SAAS_ZONE_ID / CF_FOR_SAAS_API_TOKEN are not configured.",
      503,
    );
  }
  return call<CFCustomHostname>(cfg, {
    method: "POST",
    path: "/custom_hostnames",
    body: {
      hostname: input.hostname,
      // Keep the payload MINIMAL on Free/Pro plans. The following
      // fields all require a paid SSL for SaaS plan and 1xxx-error
      // the entire create call if sent on free:
      //   - `certificate_authority` / `bundle_method` / `min_tls_version`
      //     → cf_1459 "Certificate Authority selection is only available
      //     on an Enterprise plan."
      //   - `custom_metadata`
      //     → cf_1413 "No custom metadata access has been allocated for
      //     this zone or account."
      //   - `wildcard`, `settings.ciphers`, `custom_origin_server`
      //     → 1xxx variants
      // Cloudflare picks sane defaults (DV cert via HTTP DCV, LE or
      // Google as the issuing CA). We only specify `method: "http"`
      // so DCV runs through the customer's CNAME, no DNS access
      // needed. We don't need custom_metadata — userId/domainId
      // mapping lives in our D1 keyed by hostname, which we can
      // look up at webhook time.
      ssl: {
        method: "http",
        type: "dv",
      },
    },
  });
}

export async function getCustomHostname(
  env: CloudflareEnv,
  id: string,
): Promise<CFCustomHostname> {
  const cfg = readConfig(env);
  if (!cfg) {
    throw new CFForSaasError(
      "config_missing",
      "CF_FOR_SAAS_ZONE_ID / CF_FOR_SAAS_API_TOKEN are not configured.",
      503,
    );
  }
  return call<CFCustomHostname>(cfg, {
    method: "GET",
    path: `/custom_hostnames/${encodeURIComponent(id)}`,
  });
}

export async function deleteCustomHostname(
  env: CloudflareEnv,
  id: string,
): Promise<void> {
  const cfg = readConfig(env);
  if (!cfg) {
    // Not configured = nothing to delete on CF's side. Treat as success.
    return;
  }
  try {
    await call<{ id: string }>(cfg, {
      method: "DELETE",
      path: `/custom_hostnames/${encodeURIComponent(id)}`,
    });
  } catch (err) {
    if (err instanceof CFForSaasError && err.status === 404) return; // already gone
    throw err;
  }
}

/**
 * Best-effort SSL/hostname status sync. Used by both the verify endpoint
 * and the daily re-resolution cron. Returns null when CF doesn't know
 * the hostname (deleted, never created, or wrong id).
 */
export async function pollHostnameStatus(
  env: CloudflareEnv,
  id: string,
): Promise<{ status: CFHostnameStatus; ssl: CFSslStatus } | null> {
  try {
    const ch = await getCustomHostname(env, id);
    return { status: ch.status, ssl: ch.ssl.status };
  } catch (err) {
    if (err instanceof CFForSaasError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Map CF's 21-state SSL machine onto the 4 user-visible buckets we
 * surface in the dashboard. Anything not explicitly handled becomes
 * "provisioning" — better to under-promise than to claim active too soon.
 */
export type UserVisibleSslStatus = "provisioning" | "active" | "failed";

export function userFacingSslStatus(s: CFSslStatus | null | undefined): UserVisibleSslStatus {
  if (!s) return "provisioning";
  switch (s) {
    case "active":
    case "staging_active":
      return "active";
    case "validation_timed_out":
    case "issuance_timed_out":
    case "deployment_timed_out":
    case "validation_failed":
    case "issuance_failed":
    case "deployment_failed":
    case "expired":
    case "deleted":
      return "failed";
    default:
      return "provisioning";
  }
}
