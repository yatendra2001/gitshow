import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { nanoid } from "nanoid";
import { requireProApi } from "@/lib/entitlements";
import { validateHostname, explainFailure } from "@/lib/domains/hostname";
import {
  detectProvider,
  pickApexStrategy,
  PROVIDERS,
  type ProviderId,
} from "@/lib/domains/providers";
import {
  bucketKey,
  checkRateLimit,
  CNAME_TARGET,
  isHostnameTombstoned,
  mintVerificationToken,
  RATE_LIMITS,
  recordAudit,
  tombstoneHostname,
} from "@/lib/domains/security";
import { clientIp } from "@/lib/visitor";
import {
  createDomain,
  deleteDomain,
  getDomainByHostname,
  getDomainByUser,
  type ApexStrategyDb,
} from "@/lib/domains/repo";
import { deleteCustomHostname } from "@/lib/domains/cloudflare";

/**
 * POST /api/domains  — register a new custom domain (Pro).
 * GET  /api/domains  — read the user's current domain + setup data.
 * DELETE /api/domains?id= — disconnect.
 */

export const dynamic = "force-dynamic";

interface CreateBody {
  hostname?: string;
  forceProvider?: string;
}

export async function POST(req: Request) {
  const gate = await requireProApi();
  if (!gate.ok) return gate.response;
  const userId = gate.session.user.id;
  const ua = req.headers.get("user-agent");
  const ip = clientIp(req);
  const { env } = await getCloudflareContext({ async: true });

  // ─── Rate limit ───────────────────────────────────────────────────
  const userRl = await checkRateLimit(
    env.DB,
    bucketKey("add", userId),
    RATE_LIMITS.add.limit,
    RATE_LIMITS.add.windowSec,
  );
  if (!userRl.ok) {
    return NextResponse.json(
      {
        error: "rate_limited",
        retryAfter: userRl.retryAfterSec,
        message: `Too many attempts. Try again in ${formatRetry(userRl.retryAfterSec)}.`,
      },
      { status: 429, headers: { "retry-after": String(userRl.retryAfterSec) } },
    );
  }
  const ipRl = await checkRateLimit(
    env.DB,
    bucketKey("ipAdd", ip),
    RATE_LIMITS.ipAdd.limit,
    RATE_LIMITS.ipAdd.windowSec,
  );
  if (!ipRl.ok) {
    return NextResponse.json(
      {
        error: "rate_limited",
        retryAfter: ipRl.retryAfterSec,
        message: `Too many attempts from your network. Try again in ${formatRetry(ipRl.retryAfterSec)}.`,
      },
      { status: 429, headers: { "retry-after": String(ipRl.retryAfterSec) } },
    );
  }

  // ─── Parse + validate ─────────────────────────────────────────────
  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json(
      { error: "invalid_json", message: "Couldn't read your request. Refresh and try again." },
      { status: 400 },
    );
  }

  const validated = validateHostname(body.hostname ?? "");
  if (!validated.ok) {
    return NextResponse.json(
      {
        error: "invalid_hostname",
        reason: validated.reason,
        message: explainFailure(validated.reason, validated.detail),
      },
      { status: 400 },
    );
  }
  const hostname = validated.hostname;

  // ─── User already has one? Pro = 1 domain. ────────────────────────
  const existing = await getDomainByUser(env.DB, userId);
  if (existing) {
    return NextResponse.json(
      {
        error: "already_have_domain",
        hostname: existing.hostname,
        message: "Disconnect your current domain before adding a new one.",
      },
      { status: 409 },
    );
  }

  // ─── Tombstoned? Re-claims allowed but require fresh verification.
  // Same-user re-claims bypass the cooldown — the user already proved
  // ownership and just released it, so the 30-day takeover-protection
  // window is friction with no security benefit. Other users still
  // wait it out (subdomain takeover defense). ────────────────────────
  const ts = await isHostnameTombstoned(env.DB, hostname);
  if (ts.tombstoned && ts.previousUserId !== userId) {
    return NextResponse.json(
      {
        error: "tombstoned",
        cooldownUntil: ts.cooldownUntil,
        message:
          "This domain was recently disconnected and is in a 30-day cooldown for security reasons. Try again later or contact support.",
      },
      { status: 409 },
    );
  }

  // ─── Hostname taken globally? ─────────────────────────────────────
  const owner = await getDomainByHostname(env.DB, hostname);
  if (owner && owner.user_id !== userId) {
    return NextResponse.json(
      {
        error: "hostname_taken",
        message:
          "This domain is already connected to another gitshow account. If this is your domain, contact support.",
      },
      { status: 409 },
    );
  }

  // ─── Detect provider, pick apex strategy ──────────────────────────
  const detection = await detectProvider(hostname);
  const provider: ProviderId = sanitizeProvider(body.forceProvider) ?? detection.provider;

  let apexStrategyDb: ApexStrategyDb = null;
  if (validated.isApex) {
    const strategy = pickApexStrategy(provider);
    apexStrategyDb =
      strategy === "cname_flatten"
        ? "cname_flatten"
        : strategy === "alias"
          ? "alias"
          : strategy === "www_redirect"
            ? "www_redirect"
            : null; // switch_to_cf is a guidance-only flow; persisted as null until they switch
  }

  // ─── Create row ───────────────────────────────────────────────────
  const id = `dom_${nanoid(20)}`;
  const verificationToken = await mintVerificationToken(env, userId, hostname);
  const created = await createDomain(env.DB, {
    id,
    userId,
    hostname,
    isApex: validated.isApex,
    apexStrategy: apexStrategyDb,
    detectedProvider: provider,
    verificationToken,
    setupMethod: "manual",
    ip,
    userAgent: ua,
  });
  if (!created) {
    return NextResponse.json(
      { error: "race_lost", message: "Someone just claimed this domain. Try again." },
      { status: 409 },
    );
  }

  return NextResponse.json({
    id,
    hostname,
    isApex: validated.isApex,
    apexStrategy: apexStrategyDb,
    detectedProvider: provider,
    providerLabel: PROVIDERS[provider].label,
    nameservers: detection.nameservers,
    cnameTarget: CNAME_TARGET,
    verificationToken,
    status: "pending",
    createdAt: Date.now(),
  });
}

export async function GET() {
  const gate = await requireProApi();
  if (!gate.ok) return gate.response;
  const userId = gate.session.user.id;
  const { env } = await getCloudflareContext({ async: true });
  const row = await getDomainByUser(env.DB, userId);
  if (!row) {
    return NextResponse.json({ domain: null, cnameTarget: CNAME_TARGET });
  }
  return NextResponse.json({
    domain: {
      id: row.id,
      hostname: row.hostname,
      isApex: row.is_apex === 1,
      apexStrategy: row.apex_strategy,
      status: row.status,
      detectedProvider: row.detected_provider,
      providerLabel: row.detected_provider
        ? PROVIDERS[row.detected_provider as ProviderId]?.label ?? row.detected_provider
        : null,
      verificationToken: row.verification_token,
      cfSslStatus: row.cf_ssl_status,
      failureReason: row.failure_reason,
      createdAt: row.created_at,
      activatedAt: row.activated_at,
      lastCheckAt: row.last_check_at,
    },
    cnameTarget: CNAME_TARGET,
  });
}

export async function DELETE(req: Request) {
  const gate = await requireProApi();
  if (!gate.ok) return gate.response;
  const userId = gate.session.user.id;
  const ua = req.headers.get("user-agent");
  const ip = clientIp(req);
  const { env } = await getCloudflareContext({ async: true });

  const row = await getDomainByUser(env.DB, userId);
  if (!row) return NextResponse.json({ ok: true });

  // Best-effort delete on Cloudflare side; failure here is non-fatal —
  // CF will eventually GC the orphan if our side gives up.
  if (row.cf_custom_hostname_id) {
    try {
      await deleteCustomHostname(env, row.cf_custom_hostname_id);
    } catch {
      // ignored — audit still records the deletion intent
      await recordAudit(env.DB, {
        customDomainId: row.id,
        userId,
        eventType: "deleted",
        actor: "user",
        ip,
        userAgent: ua,
        metadata: { cf_delete_failed: true },
      });
    }
  }

  await deleteDomain(env.DB, row.id, userId, { ip, userAgent: ua, actor: "user" });
  await tombstoneHostname(env.DB, row.hostname, userId);

  return NextResponse.json({ ok: true, hostname: row.hostname });
}

function sanitizeProvider(input: string | undefined): ProviderId | null {
  if (!input) return null;
  // Allow any of our known provider ids
  const v = input as ProviderId;
  return v in PROVIDERS ? v : null;
}

/** "3 min 29 sec" / "47 sec" — used in user-facing rate-limit messages. */
function formatRetry(seconds: number): string {
  if (seconds < 60) return `${seconds} sec`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (s === 0) return `${m} min`;
  return `${m} min ${s} sec`;
}
