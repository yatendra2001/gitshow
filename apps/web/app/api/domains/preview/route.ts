import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireProApi } from "@/lib/entitlements";
import { validateHostname, explainFailure } from "@/lib/domains/hostname";
import {
  detectProvider,
  PROVIDERS,
  pickApexStrategy,
  curatedInstructions,
  instructionKindFor,
  type InstructionSet,
  type ProviderId,
} from "@/lib/domains/providers";
import { CNAME_TARGET, isHostnameTombstoned, RATE_LIMITS, bucketKey, checkRateLimit } from "@/lib/domains/security";
import { generateProviderInstructions } from "@/lib/domains/gemini";
import { getDomainByHostname, getDomainByUser } from "@/lib/domains/repo";

/**
 * POST /api/domains/preview — preview the setup flow without committing.
 *
 * The settings UI calls this whenever the input changes (debounced) so
 * we can show:
 *   - Validation result (red error if invalid).
 *   - Detected DNS provider chip ("Detected: Cloudflare").
 *   - Apex strategy chosen (subdomain / flatten / alias / www_redirect).
 *   - The exact instruction set we're going to render — curated where
 *     possible, Gemini-grounded fallback otherwise.
 *
 * Read-only: no rows written, no CF API calls. Cheap because we cache
 * Gemini outputs by (provider, kind) for 30 days and the curated cards
 * are pure functions.
 */

export const runtime = "edge";
export const dynamic = "force-dynamic";

interface PreviewBody {
  hostname?: string;
  forceProvider?: string;
}

export async function POST(req: Request) {
  const gate = await requireProApi();
  if (!gate.ok) return gate.response;
  const userId = gate.session.user.id;
  const { env } = await getCloudflareContext({ async: true });

  // Tiny rate limit on preview — abuse vector is repeatedly hitting
  // the Gemini path. Curated previews don't burn budget; we still
  // throttle to discourage scrapers.
  const rl = await checkRateLimit(
    env.DB,
    bucketKey("verify", userId), // share with verify (different ceiling not needed)
    RATE_LIMITS.verify.limit * 4,
    RATE_LIMITS.verify.windowSec,
  );
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited", retryAfter: rl.retryAfterSec },
      { status: 429 },
    );
  }

  let body: PreviewBody;
  try {
    body = (await req.json()) as PreviewBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const validated = validateHostname(body.hostname ?? "");
  if (!validated.ok) {
    return NextResponse.json({
      ok: false,
      reason: validated.reason,
      message: explainFailure(validated.reason, validated.detail),
    });
  }
  const hostname = validated.hostname;

  // Tombstone soft-warn (still allowed but flagged in UI).
  const ts = await isHostnameTombstoned(env.DB, hostname);

  // Other-user owned check (informational — actual lock is at create time).
  const owned = await getDomainByHostname(env.DB, hostname);
  if (owned && owned.user_id !== userId) {
    return NextResponse.json({
      ok: false,
      reason: "hostname_taken",
      message:
        "This domain is already connected to another gitshow account.",
    });
  }

  // Detect provider (or use override).
  const detection = await detectProvider(hostname);
  const provider: ProviderId = sanitizeProvider(body.forceProvider) ?? detection.provider;
  const providerInfo = PROVIDERS[provider];
  const apexStrategy = validated.isApex ? pickApexStrategy(provider) : null;
  const apexHint = validated.isApex ? "apex_needs_strategy" : "subdomain";
  const kind = instructionKindFor(apexHint, apexStrategy);
  const verifyKind: InstructionSet["kind"] = "txt_verify";

  // Build the record name + value the instructions card will copy.
  const recordName = computeRecordName(hostname, kind, validated.isApex);
  const recordValue = CNAME_TARGET;

  // 1. Curated card?
  let setupCard: InstructionSet | null = curatedInstructions(provider, kind, {
    hostname,
    cnameTarget: CNAME_TARGET,
  });
  let curated = !!setupCard;
  let citations: string[] = [];

  // 2. Generic fallback for known providers without a curated card?
  if (!setupCard) {
    setupCard = genericInstructions(provider, kind, hostname, recordValue);
  }

  // 3. Long-tail / unknown — try Gemini.
  let usedGemini = false;
  if (provider === "unknown" || !curated) {
    const gen = await generateProviderInstructions(env, env.DB, {
      providerLabel: providerInfo.label,
      recordType: kind === "txt_verify" ? "TXT" : "CNAME",
      recordName,
      recordValue,
      hostname,
      instructionKind: kind,
    });
    if (gen) {
      setupCard = {
        provider,
        kind,
        title: `Add a record on ${providerInfo.label}`,
        steps: gen.steps,
      };
      citations = gen.citations;
      usedGemini = true;
      curated = false;
    }
  }

  // Verify card — TXT instructions for the ownership challenge.
  // Curated where available, generic + Gemini otherwise.
  let verifyCard: InstructionSet | null = curatedInstructions(provider, verifyKind, {
    hostname,
    cnameTarget: CNAME_TARGET,
    verifyName: `_cf-custom-hostname.${hostname}`,
    verifyValue: "<we'll show this once you click Connect>",
  });
  if (!verifyCard) {
    verifyCard = {
      provider,
      kind: verifyKind,
      title: `Add a TXT record on ${providerInfo.label}`,
      steps: [
        { text: `Open ${providerInfo.label} DNS settings.` },
        { text: "Add a TXT record." },
        {
          text: `Host: _cf-custom-hostname.${labelOrApex(hostname, validated.isApex)}`,
          copyValue: `_cf-custom-hostname.${labelOrApex(hostname, validated.isApex)}`,
        },
        { text: "Value: we'll show the exact token after you click Connect." },
      ],
    };
  }

  return NextResponse.json({
    ok: true,
    hostname,
    isApex: validated.isApex,
    rootDomain: validated.rootDomain,
    apexStrategy,
    detectedProvider: provider,
    providerLabel: providerInfo.label,
    providerHelpUrl: providerInfo.helpUrl ?? null,
    nameservers: detection.nameservers,
    cnameTarget: CNAME_TARGET,
    setupCard,
    verifyCard,
    citations,
    sourceTier: usedGemini ? "ai_generated" : curated ? "curated" : "generic",
    tombstoneWarning: ts.tombstoned ? { cooldownUntil: ts.cooldownUntil } : null,
  });
}

function sanitizeProvider(input: string | undefined): ProviderId | null {
  if (!input) return null;
  const v = input as ProviderId;
  return v in PROVIDERS ? v : null;
}

function labelOrApex(hostname: string, isApex: boolean): string {
  if (isApex) return hostname;
  const labels = hostname.split(".");
  return labels.slice(0, -2).join(".");
}

function computeRecordName(
  hostname: string,
  kind: InstructionSet["kind"],
  isApex: boolean,
): string {
  if (kind === "txt_verify") return `_cf-custom-hostname.${hostname}`;
  if (kind === "apex_url_forward") {
    // user enters CNAME on www, plus apex 301-forward — the record we
    // tell them to put down is on `www`.
    return "www";
  }
  if (isApex) return "@";
  return labelOrApex(hostname, false);
}

function genericInstructions(
  provider: ProviderId,
  kind: InstructionSet["kind"],
  hostname: string,
  cnameTarget: string,
): InstructionSet {
  const info = PROVIDERS[provider];
  if (kind === "apex_url_forward") {
    return {
      provider,
      kind,
      title: `Set up apex forwarding on ${info.label}`,
      deepLink: info.helpUrl,
      steps: [
        { text: `Open ${info.label} DNS settings for ${hostname}.` },
        { text: "Add a CNAME: Host = www, Value below." },
        { text: cnameTarget, copyValue: cnameTarget },
        { text: `Add an apex URL forward / domain forward: ${hostname} → https://www.${hostname}` },
        { text: "Type / status: Permanent (301). Save." },
      ],
    };
  }
  if (kind === "apex_alias") {
    return {
      provider,
      kind,
      title: `Add an ALIAS at the root on ${info.label}`,
      deepLink: info.helpUrl,
      steps: [
        { text: `Open ${info.label} DNS settings for ${hostname}.` },
        { text: "Add a record: Type = ALIAS (or ANAME)." },
        { text: "Host: leave blank for the root (apex)." },
        { text: cnameTarget, copyValue: cnameTarget },
        { text: "Save." },
      ],
    };
  }
  if (kind === "cname_apex_flatten") {
    return {
      provider,
      kind,
      title: `Add a flattened CNAME at the root on ${info.label}`,
      deepLink: info.helpUrl,
      steps: [
        { text: `Open ${info.label} DNS settings for ${hostname}.` },
        { text: "Add a record: Type = CNAME." },
        { text: "Name: @ (root). The DNS provider will flatten to A automatically." },
        { text: cnameTarget, copyValue: cnameTarget },
        { text: "Save (DNS only / no proxy)." },
      ],
    };
  }
  if (kind === "txt_verify") {
    return {
      provider,
      kind,
      title: `Add a TXT record on ${info.label}`,
      deepLink: info.helpUrl,
      steps: [
        { text: `Open ${info.label} DNS settings for ${hostname}.` },
        { text: "Add a record: Type = TXT." },
        {
          text: `Host: _cf-custom-hostname.${hostname.split(".").slice(0, -2).join(".") || hostname}`,
          copyValue: `_cf-custom-hostname.${hostname.split(".").slice(0, -2).join(".") || hostname}`,
        },
        { text: "Value: paste the verification token from this page." },
        { text: "Save." },
      ],
    };
  }
  // cname_subdomain default
  return {
    provider,
    kind,
    title: `Add a CNAME on ${info.label}`,
    deepLink: info.helpUrl,
    steps: [
      { text: `Open ${info.label} DNS settings for ${hostname}.` },
      { text: "Add a record: Type = CNAME." },
      {
        text: `Name: ${hostname.split(".").slice(0, -2).join(".") || "@"}`,
        copyValue: hostname.split(".").slice(0, -2).join(".") || "@",
      },
      { text: cnameTarget, copyValue: cnameTarget },
      { text: "Save (DNS only / no proxy)." },
    ],
  };
}
