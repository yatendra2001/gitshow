/**
 * DNS provider detection + setup-instruction database.
 *
 * Two independent things in this file:
 *
 *   1. detectProvider(hostname) — NS lookup against DNS-over-HTTPS,
 *      pattern-match the nameservers against a known table of providers.
 *      Returns the provider id or 'unknown'. Fast, ~100-200ms.
 *
 *   2. PROVIDERS — hand-curated map of provider → setup instructions
 *      for each strategy (subdomain CNAME, apex flatten, apex ALIAS,
 *      apex URL forwarding, TXT verification). The 5 we curate ship
 *      day-1; everything else falls through to either Domain-Connect-
 *      compatible providers (also curated) or the Gemini fallback.
 *
 * The detection list is intentionally larger than the curated provider
 * set: knowing it's GoDaddy lets us pick the *right* generic-instructions
 * card ("apex URL forwarding") instead of the most-generic one.
 */

import type { ApexHint } from "./hostname";

// ─── Detection ─────────────────────────────────────────────────────────

export type ProviderId =
  | "cloudflare"
  | "namecheap"
  | "godaddy"
  | "route53"
  | "squarespace"
  | "porkbun"
  | "google_domains"
  | "ionos"
  | "namesilo"
  | "hover"
  | "name_com"
  | "dynadot"
  | "dnsimple"
  | "ns1"
  | "easydns"
  | "gandi"
  | "ovh"
  | "vercel"
  | "netlify"
  | "fastmail"
  | "bluehost"
  | "hostgator"
  | "wix"
  | "shopify"
  | "unknown";

// Pattern → provider. Order matters — the most specific patterns first.
// `endsWith` semantics on the FQDN with a trailing dot stripped first.
const NS_PATTERNS: Array<{ provider: ProviderId; suffixes: string[] }> = [
  { provider: "cloudflare", suffixes: ["ns.cloudflare.com"] },
  { provider: "godaddy", suffixes: ["domaincontrol.com"] },
  { provider: "namecheap", suffixes: ["registrar-servers.com"] },
  { provider: "route53", suffixes: ["awsdns-00.com", "awsdns-00.net", "awsdns-00.org", "awsdns-00.co.uk", "awsdns.com", "awsdns.net", "awsdns.org", "awsdns.co.uk"] },
  { provider: "squarespace", suffixes: ["squarespacedns.com"] },
  { provider: "porkbun", suffixes: ["porkbun.com"] },
  { provider: "google_domains", suffixes: ["googledomains.com", "domains.google"] },
  { provider: "ionos", suffixes: ["ui-dns.com", "ui-dns.org", "ui-dns.biz", "ui-dns.de"] },
  { provider: "namesilo", suffixes: ["namesilo.com"] },
  { provider: "hover", suffixes: ["hover.com"] },
  { provider: "name_com", suffixes: ["name.com"] },
  { provider: "dynadot", suffixes: ["dynadot.com"] },
  { provider: "dnsimple", suffixes: ["dnsimple.com"] },
  { provider: "ns1", suffixes: ["nsone.net"] },
  { provider: "easydns", suffixes: ["easydns.com", "easydns.net", "easydns.info", "easydns.org"] },
  { provider: "gandi", suffixes: ["gandi.net"] },
  { provider: "ovh", suffixes: ["ovh.net", "ovh.ca"] },
  { provider: "vercel", suffixes: ["vercel-dns.com"] },
  { provider: "netlify", suffixes: ["nsone.net", "netlify.com"] },
  { provider: "fastmail", suffixes: ["messagingengine.com"] },
  { provider: "bluehost", suffixes: ["bluehost.com"] },
  { provider: "hostgator", suffixes: ["hostgator.com"] },
  { provider: "wix", suffixes: ["wixdns.net"] },
  { provider: "shopify", suffixes: ["shopify.com"] },
];

/**
 * Find the registrable base for an NS lookup. NS records live at the
 * zone apex, so for `me.example.com` we want to query
 * NS for `example.com`, not `me.example.com`.
 *
 * We keep this simple: drop subdomains until we have ≤2 labels (or 3
 * for known multi-label TLDs — handled via a quick suffix check). The
 * full Public Suffix List would be more correct but the false-positive
 * rate of "query NS too low" is low (DNS resolvers walk up themselves).
 */
function zoneApexFor(hostname: string): string {
  const labels = hostname.split(".");
  if (labels.length <= 2) return hostname;
  // Known multi-label suffixes — match the same set we use in
  // hostname.ts PUBLIC_SUFFIXES (small subset is fine).
  const last2 = labels.slice(-2).join(".");
  const last3 = labels.slice(-3).join(".");
  const ML = new Set([
    "co.uk",
    "co.in",
    "co.jp",
    "com.au",
    "com.br",
    "com.mx",
    "com.cn",
    "co.za",
    "co.nz",
    "co.id",
    "co.kr",
  ]);
  if (ML.has(last2)) {
    return last3;
  }
  return last2;
}

export interface DetectionResult {
  provider: ProviderId;
  nameservers: string[];
  zoneApex: string;
}

interface DohAnswer {
  Answer?: Array<{ name: string; type: number; data: string; TTL?: number }>;
  Status: number;
}

/**
 * NS lookup via DNS-over-HTTPS. We query Cloudflare's resolver
 * (1.1.1.1) directly because it runs on the same edge as our worker
 * — sub-50ms typical.
 *
 * Returns the matched provider and the raw nameservers. `unknown`
 * means we got NS records but no pattern matched; `unknown` with
 * `nameservers: []` means we got nothing back at all (NXDOMAIN,
 * resolver flake, etc.).
 */
export async function detectProvider(
  hostname: string,
): Promise<DetectionResult> {
  const apex = zoneApexFor(hostname);
  const nameservers = await fetchNS(apex);
  const provider = matchProvider(nameservers);
  return { provider, nameservers, zoneApex: apex };
}

async function fetchNS(zone: string): Promise<string[]> {
  try {
    const url = `https://1.1.1.1/dns-query?name=${encodeURIComponent(zone)}&type=NS`;
    const res = await fetch(url, {
      headers: { accept: "application/dns-json" },
      // CF Workers fetch — 5s timeout via AbortSignal
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as DohAnswer;
    if (json.Status !== 0) return [];
    return (json.Answer ?? [])
      .filter((a) => a.type === 2) // NS record type
      .map((a) => a.data.replace(/\.$/, "").toLowerCase());
  } catch {
    return [];
  }
}

function matchProvider(nameservers: string[]): ProviderId {
  for (const ns of nameservers) {
    for (const { provider, suffixes } of NS_PATTERNS) {
      for (const suffix of suffixes) {
        if (ns === suffix || ns.endsWith(`.${suffix}`)) return provider;
      }
    }
  }
  return "unknown";
}

// ─── Provider capabilities + apex strategy ─────────────────────────────

export type ApexStrategy =
  | "cname_flatten" // CNAME @ → cname.gitshow.io, provider flattens to A
  | "alias" // ALIAS / ANAME @ → cname.gitshow.io
  | "www_redirect" // CNAME www + apex 301-forwards
  | "switch_to_cf"; // last-resort: move NS to Cloudflare

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  /** Best apex strategy for this provider, in order. */
  apexStrategies: ApexStrategy[];
  /** True if the provider supports flattening a CNAME at apex. */
  supportsCnameFlatten: boolean;
  /** True if the provider supports ALIAS/ANAME records. */
  supportsAlias: boolean;
  /** True if the provider has a built-in apex URL forwarding feature. */
  supportsApexForward: boolean;
  /** Marketing URL (used for the "open in your provider" CTA). */
  helpUrl?: string;
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  cloudflare: {
    id: "cloudflare",
    label: "Cloudflare",
    // CNAME flattening at apex (cname_flatten) routes traffic correctly
    // BUT Cloudflare for SaaS hostname VALIDATION can't complete on a
    // Cloudflare-hosted apex — CF refuses TXT/HTTP pre-validation tokens
    // for Cloudflare-hosted customer domains, and flattening hides the
    // literal CNAME from CF's lookup. The only way to make apex work
    // here is Enterprise "Apex Proxying" ($$$). For Free/Pro plans we
    // route through www + a 301 redirect from the apex — same end-user
    // experience for typing the bare domain, validation passes because
    // www CNAMEs aren't flattened.
    apexStrategies: ["www_redirect"],
    supportsCnameFlatten: true, // technically supported, just not for SaaS validation
    supportsAlias: false,
    supportsApexForward: true, // via Redirect Rules
    helpUrl: "https://dash.cloudflare.com/?to=/:account/:zone/dns/records",
  },
  namecheap: {
    id: "namecheap",
    label: "Namecheap",
    apexStrategies: ["www_redirect", "switch_to_cf"],
    supportsCnameFlatten: false,
    supportsAlias: false,
    supportsApexForward: true,
    helpUrl: "https://ap.www.namecheap.com/Domains/DomainControlPanel/",
  },
  godaddy: {
    id: "godaddy",
    label: "GoDaddy",
    apexStrategies: ["www_redirect", "switch_to_cf"],
    supportsCnameFlatten: false,
    supportsAlias: false,
    supportsApexForward: true,
    helpUrl: "https://dcc.godaddy.com/domains",
  },
  squarespace: {
    id: "squarespace",
    label: "Squarespace Domains",
    apexStrategies: ["www_redirect", "switch_to_cf"],
    supportsCnameFlatten: false,
    supportsAlias: false,
    supportsApexForward: true,
    helpUrl: "https://account.squarespace.com/domains",
  },
  porkbun: {
    id: "porkbun",
    label: "Porkbun",
    apexStrategies: ["alias", "www_redirect"],
    supportsCnameFlatten: false,
    supportsAlias: true,
    supportsApexForward: true,
    helpUrl: "https://porkbun.com/account/domainsSpeedy",
  },
  route53: {
    id: "route53",
    label: "AWS Route 53",
    apexStrategies: ["www_redirect", "switch_to_cf"],
    supportsCnameFlatten: false,
    supportsAlias: false, // Route53 ALIAS only targets AWS resources
    supportsApexForward: false,
    helpUrl: "https://console.aws.amazon.com/route53/",
  },
  google_domains: {
    id: "google_domains",
    label: "Google Domains / Squarespace",
    apexStrategies: ["www_redirect", "switch_to_cf"],
    supportsCnameFlatten: false,
    supportsAlias: false,
    supportsApexForward: true,
  },
  ionos: {
    id: "ionos",
    label: "IONOS",
    apexStrategies: ["alias", "www_redirect"],
    supportsCnameFlatten: false,
    supportsAlias: true,
    supportsApexForward: true,
  },
  namesilo: {
    id: "namesilo",
    label: "NameSilo",
    apexStrategies: ["alias", "www_redirect"],
    supportsCnameFlatten: false,
    supportsAlias: true,
    supportsApexForward: true,
  },
  hover: {
    id: "hover",
    label: "Hover",
    apexStrategies: ["www_redirect", "switch_to_cf"],
    supportsCnameFlatten: false,
    supportsAlias: false,
    supportsApexForward: true,
  },
  name_com: {
    id: "name_com",
    label: "Name.com",
    apexStrategies: ["www_redirect", "switch_to_cf"],
    supportsCnameFlatten: false,
    supportsAlias: false,
    supportsApexForward: true,
  },
  dynadot: {
    id: "dynadot",
    label: "Dynadot",
    apexStrategies: ["www_redirect", "switch_to_cf"],
    supportsCnameFlatten: false,
    supportsAlias: false,
    supportsApexForward: true,
  },
  dnsimple: {
    id: "dnsimple",
    label: "DNSimple",
    apexStrategies: ["alias"],
    supportsCnameFlatten: false,
    supportsAlias: true,
    supportsApexForward: false,
  },
  ns1: {
    id: "ns1",
    label: "NS1",
    apexStrategies: ["alias"],
    supportsCnameFlatten: false,
    supportsAlias: true,
    supportsApexForward: false,
  },
  easydns: {
    id: "easydns",
    label: "easyDNS",
    apexStrategies: ["alias"],
    supportsCnameFlatten: false,
    supportsAlias: true,
    supportsApexForward: false,
  },
  gandi: {
    id: "gandi",
    label: "Gandi",
    apexStrategies: ["www_redirect", "switch_to_cf"],
    supportsCnameFlatten: false,
    supportsAlias: false,
    supportsApexForward: true,
  },
  ovh: {
    id: "ovh",
    label: "OVH",
    apexStrategies: ["www_redirect", "switch_to_cf"],
    supportsCnameFlatten: false,
    supportsAlias: false,
    supportsApexForward: true,
  },
  vercel: {
    id: "vercel",
    label: "Vercel DNS",
    apexStrategies: ["alias", "switch_to_cf"],
    supportsCnameFlatten: false,
    supportsAlias: true,
    supportsApexForward: false,
  },
  netlify: {
    id: "netlify",
    label: "Netlify DNS",
    apexStrategies: ["alias", "switch_to_cf"],
    supportsCnameFlatten: false,
    supportsAlias: true,
    supportsApexForward: false,
  },
  fastmail: {
    id: "fastmail",
    label: "Fastmail (DNS)",
    apexStrategies: ["www_redirect", "switch_to_cf"],
    supportsCnameFlatten: false,
    supportsAlias: false,
    supportsApexForward: false,
  },
  bluehost: {
    id: "bluehost",
    label: "Bluehost",
    apexStrategies: ["www_redirect", "switch_to_cf"],
    supportsCnameFlatten: false,
    supportsAlias: false,
    supportsApexForward: true,
  },
  hostgator: {
    id: "hostgator",
    label: "HostGator",
    apexStrategies: ["www_redirect", "switch_to_cf"],
    supportsCnameFlatten: false,
    supportsAlias: false,
    supportsApexForward: true,
  },
  wix: {
    id: "wix",
    label: "Wix",
    apexStrategies: ["www_redirect", "switch_to_cf"],
    supportsCnameFlatten: false,
    supportsAlias: false,
    supportsApexForward: true,
  },
  shopify: {
    id: "shopify",
    label: "Shopify",
    apexStrategies: ["www_redirect", "switch_to_cf"],
    supportsCnameFlatten: false,
    supportsAlias: false,
    supportsApexForward: false,
  },
  unknown: {
    id: "unknown",
    label: "Your DNS provider",
    apexStrategies: ["www_redirect", "switch_to_cf"],
    supportsCnameFlatten: false,
    supportsAlias: false,
    supportsApexForward: false,
  },
};

/**
 * Pick the best apex strategy given the provider and the user's
 * preference (we always present the easiest path first).
 */
export function pickApexStrategy(provider: ProviderId): ApexStrategy {
  const info = PROVIDERS[provider];
  return info.apexStrategies[0] ?? "www_redirect";
}

/**
 * What does the user need to do? This is the data the UI renders
 * for the curated tier (Cloudflare, Namecheap, GoDaddy, Squarespace,
 * Porkbun). Other providers fall through to either the generic card
 * (using `apexStrategies[0]`) or to the Gemini-grounded fallback.
 */
export interface InstructionStep {
  /** Numbered step body. May contain a single inline `code` segment. */
  text: string;
  /** Optional copy-able value (e.g. the CNAME target). Renders as a code chip. */
  copyValue?: string;
}

export interface InstructionSet {
  provider: ProviderId;
  /** What kind of record this set describes (matches DB cache key). */
  kind:
    | "cname_subdomain"
    | "cname_apex_flatten"
    | "apex_alias"
    | "apex_url_forward"
    | "txt_verify";
  /** Human label shown in the UI */
  title: string;
  steps: InstructionStep[];
  /** Direct deep-link to the provider's DNS panel, if known. */
  deepLink?: string;
}

/**
 * Decide which InstructionSet to render. Returns the curated one when
 * it exists, else null — the caller (UI or API) should then fall back
 * to the generic / Gemini-grounded set.
 */
export function curatedInstructions(
  provider: ProviderId,
  kind: InstructionSet["kind"],
  ctx: { hostname: string; cnameTarget: string; verifyName?: string; verifyValue?: string },
): InstructionSet | null {
  const fn = CURATED[provider]?.[kind];
  if (!fn) return null;
  return fn(ctx);
}

type Builder = (ctx: {
  hostname: string;
  cnameTarget: string;
  verifyName?: string;
  verifyValue?: string;
}) => InstructionSet;

const CURATED: Partial<Record<ProviderId, Partial<Record<InstructionSet["kind"], Builder>>>> = {
  cloudflare: {
    cname_subdomain: (c) => ({
      provider: "cloudflare",
      kind: "cname_subdomain",
      title: "Add a CNAME on Cloudflare",
      deepLink: PROVIDERS.cloudflare.helpUrl,
      steps: [
        { text: "Open Cloudflare dashboard → DNS → Records." },
        { text: "Click Add record. Type: CNAME." },
        { text: `Name: ${labelFor(c.hostname)}`, copyValue: labelFor(c.hostname) },
        { text: `Target: ${c.cnameTarget}`, copyValue: c.cnameTarget },
        { text: "Proxy status: DNS only (grey cloud). Save." },
      ],
    }),
    cname_apex_flatten: (c) => ({
      provider: "cloudflare",
      kind: "cname_apex_flatten",
      title: "Add a flattened CNAME at the root",
      deepLink: PROVIDERS.cloudflare.helpUrl,
      steps: [
        { text: "Open Cloudflare dashboard → DNS → Records." },
        {
          text:
            "If the root has any existing A or AAAA records, delete them first — Cloudflare won't allow a root CNAME alongside them.",
        },
        { text: "Click Add record. Type: CNAME." },
        { text: "Name: @ (Cloudflare flattens this to A records automatically.)" },
        { text: `Target: ${c.cnameTarget}`, copyValue: c.cnameTarget },
        { text: "Proxy status: DNS only (grey cloud). Save." },
      ],
    }),
    apex_url_forward: (c) => ({
      provider: "cloudflare",
      kind: "apex_url_forward",
      title: "Route apex to www via a Redirect Rule",
      deepLink: PROVIDERS.cloudflare.helpUrl,
      steps: [
        { text: "Open Cloudflare dashboard → DNS → Records." },
        {
          text: "If the root has any existing A, AAAA, or CNAME records, delete them — they'd shadow the redirect rule.",
        },
        { text: "Click Add record. Type: CNAME, Name: www." },
        { text: `Target: ${c.cnameTarget}`, copyValue: c.cnameTarget },
        { text: "Proxy status: DNS only (grey cloud). Save." },
        {
          text: "Then go to Rules → Redirect Rules → Create rule. When hostname equals " +
            rootDomain(c.hostname) +
            ", static redirect (301) to https://www." + rootDomain(c.hostname) + " — preserve query string and path.",
        },
      ],
    }),
    txt_verify: (c) => ({
      provider: "cloudflare",
      kind: "txt_verify",
      title: "Add the verification TXT record",
      deepLink: PROVIDERS.cloudflare.helpUrl,
      steps: [
        { text: "Open Cloudflare dashboard → DNS → Records." },
        { text: "Click Add record. Type: TXT." },
        { text: `Name: ${c.verifyName ?? "_cf-custom-hostname"}`, copyValue: c.verifyName },
        { text: `Content: ${c.verifyValue ?? ""}`, copyValue: c.verifyValue },
        { text: "Save. We'll detect it within ~30s." },
      ],
    }),
  },
  namecheap: {
    cname_subdomain: (c) => ({
      provider: "namecheap",
      kind: "cname_subdomain",
      title: "Add a CNAME on Namecheap",
      deepLink: PROVIDERS.namecheap.helpUrl,
      steps: [
        { text: "Open Namecheap → Domain List → Manage → Advanced DNS." },
        { text: "Click Add new record. Type: CNAME Record." },
        { text: `Host: ${labelFor(c.hostname)}`, copyValue: labelFor(c.hostname) },
        { text: `Value: ${c.cnameTarget}`, copyValue: c.cnameTarget },
        { text: "TTL: Automatic. Save (green checkmark)." },
      ],
    }),
    apex_url_forward: (c) => ({
      provider: "namecheap",
      kind: "apex_url_forward",
      title: "Set up apex forwarding to www on Namecheap",
      deepLink: PROVIDERS.namecheap.helpUrl,
      steps: [
        { text: "Open Namecheap → Domain List → Manage → Advanced DNS." },
        { text: "Add a CNAME record: Host = www, Value below." },
        { text: c.cnameTarget, copyValue: c.cnameTarget },
        {
          text: "Switch to the Domain tab → Redirect Domain → Add Redirect.",
        },
        {
          text: `Source URL: ${rootDomain(c.hostname)} → Destination: https://www.${rootDomain(c.hostname)}`,
        },
        { text: "Type: Permanent (301), Mode: Wildcard (no masking). Save." },
      ],
    }),
    txt_verify: (c) => ({
      provider: "namecheap",
      kind: "txt_verify",
      title: "Add the verification TXT on Namecheap",
      deepLink: PROVIDERS.namecheap.helpUrl,
      steps: [
        { text: "Open Namecheap → Domain List → Manage → Advanced DNS." },
        { text: "Click Add new record. Type: TXT Record." },
        { text: `Host: ${c.verifyName ?? "_cf-custom-hostname"}`, copyValue: c.verifyName },
        { text: `Value: ${c.verifyValue ?? ""}`, copyValue: c.verifyValue },
        { text: "TTL: Automatic. Save." },
      ],
    }),
  },
  godaddy: {
    cname_subdomain: (c) => ({
      provider: "godaddy",
      kind: "cname_subdomain",
      title: "Add a CNAME on GoDaddy",
      deepLink: PROVIDERS.godaddy.helpUrl,
      steps: [
        { text: "Open GoDaddy → My Products → Domains → DNS." },
        { text: "Click Add → Type: CNAME." },
        { text: `Name: ${labelFor(c.hostname)}`, copyValue: labelFor(c.hostname) },
        { text: `Value: ${c.cnameTarget}`, copyValue: c.cnameTarget },
        { text: "TTL: 1 Hour. Save." },
      ],
    }),
    apex_url_forward: (c) => ({
      provider: "godaddy",
      kind: "apex_url_forward",
      title: "Set up apex forwarding to www on GoDaddy",
      deepLink: PROVIDERS.godaddy.helpUrl,
      steps: [
        { text: "Open GoDaddy → My Products → Domains → DNS." },
        { text: "Add a CNAME: Name = www, Value below." },
        { text: c.cnameTarget, copyValue: c.cnameTarget },
        { text: "Open the Forwarding tab on the same domain → Add Forwarding." },
        {
          text: `Forward to: https://www.${rootDomain(c.hostname)}, Type: Permanent (301).`,
        },
        { text: "Settings: Forward only (no masking). Save." },
      ],
    }),
    txt_verify: (c) => ({
      provider: "godaddy",
      kind: "txt_verify",
      title: "Add the verification TXT on GoDaddy",
      deepLink: PROVIDERS.godaddy.helpUrl,
      steps: [
        { text: "Open GoDaddy → My Products → Domains → DNS → Add." },
        { text: "Type: TXT." },
        { text: `Name: ${c.verifyName ?? "_cf-custom-hostname"}`, copyValue: c.verifyName },
        { text: `Value: ${c.verifyValue ?? ""}`, copyValue: c.verifyValue },
        { text: "TTL: 1 Hour. Save." },
      ],
    }),
  },
  squarespace: {
    cname_subdomain: (c) => ({
      provider: "squarespace",
      kind: "cname_subdomain",
      title: "Add a CNAME on Squarespace Domains",
      deepLink: PROVIDERS.squarespace.helpUrl,
      steps: [
        { text: "Open Squarespace Domains → your domain → DNS Settings." },
        { text: "Custom Records → Add Record. Type: CNAME." },
        { text: `Host: ${labelFor(c.hostname)}`, copyValue: labelFor(c.hostname) },
        { text: `Data: ${c.cnameTarget}`, copyValue: c.cnameTarget },
        { text: "Save." },
      ],
    }),
    apex_url_forward: (c) => ({
      provider: "squarespace",
      kind: "apex_url_forward",
      title: "Set up apex forwarding to www on Squarespace",
      deepLink: PROVIDERS.squarespace.helpUrl,
      steps: [
        { text: "Open Squarespace Domains → DNS Settings → Add CNAME." },
        { text: `Host: www, Data: ${c.cnameTarget}`, copyValue: c.cnameTarget },
        { text: "Open Domain Forwarding → Add forwarding." },
        {
          text: `Forward ${rootDomain(c.hostname)} → https://www.${rootDomain(c.hostname)}, Type: 301.`,
        },
        { text: "Save." },
      ],
    }),
    txt_verify: (c) => ({
      provider: "squarespace",
      kind: "txt_verify",
      title: "Add the verification TXT on Squarespace",
      deepLink: PROVIDERS.squarespace.helpUrl,
      steps: [
        { text: "Open Squarespace Domains → DNS Settings → Add Record. Type: TXT." },
        { text: `Host: ${c.verifyName ?? "_cf-custom-hostname"}`, copyValue: c.verifyName },
        { text: `Data: ${c.verifyValue ?? ""}`, copyValue: c.verifyValue },
        { text: "Save." },
      ],
    }),
  },
  porkbun: {
    cname_subdomain: (c) => ({
      provider: "porkbun",
      kind: "cname_subdomain",
      title: "Add a CNAME on Porkbun",
      deepLink: PROVIDERS.porkbun.helpUrl,
      steps: [
        { text: "Open Porkbun → Domain Management → Details → DNS." },
        { text: "Add Record. Type: CNAME." },
        { text: `Host: ${labelFor(c.hostname)}`, copyValue: labelFor(c.hostname) },
        { text: `Answer: ${c.cnameTarget}`, copyValue: c.cnameTarget },
        { text: "TTL: 600. Add Record." },
      ],
    }),
    apex_alias: (c) => ({
      provider: "porkbun",
      kind: "apex_alias",
      title: "Add an ALIAS at the root on Porkbun",
      deepLink: PROVIDERS.porkbun.helpUrl,
      steps: [
        { text: "Open Porkbun → Domain Management → Details → DNS." },
        { text: "Add Record. Type: ALIAS." },
        { text: "Host: leave blank (this is the apex)." },
        { text: `Answer: ${c.cnameTarget}`, copyValue: c.cnameTarget },
        { text: "TTL: 600. Add Record." },
      ],
    }),
    txt_verify: (c) => ({
      provider: "porkbun",
      kind: "txt_verify",
      title: "Add the verification TXT on Porkbun",
      deepLink: PROVIDERS.porkbun.helpUrl,
      steps: [
        { text: "Open Porkbun → Domain Management → DNS → Add Record. Type: TXT." },
        { text: `Host: ${c.verifyName ?? "_cf-custom-hostname"}`, copyValue: c.verifyName },
        { text: `Answer: ${c.verifyValue ?? ""}`, copyValue: c.verifyValue },
        { text: "Add Record." },
      ],
    }),
  },
};

// ─── Helpers ───────────────────────────────────────────────────────────

/**
 * The "name" / "host" field for the user's DNS record. For
 * `me.example.com` that's `me`; for apex flow we hand back `@` so the
 * caller can swap in provider-specific apex placeholders.
 */
export function labelFor(hostname: string): string {
  const labels = hostname.split(".");
  if (labels.length === 2) return "@";
  return labels.slice(0, -2).join(".");
}

export function rootDomain(hostname: string): string {
  // Mirrors zoneApexFor — keep the two in sync; intentionally duplicated
  // so this file has zero external imports beyond `./hostname`.
  const labels = hostname.split(".");
  if (labels.length <= 2) return hostname;
  return labels.slice(-2).join(".");
}

/**
 * What instruction-kind do we need for this hostname? Used by the API
 * layer to decide which curated card (or Gemini fallback) to fetch.
 */
export function instructionKindFor(
  hint: ApexHint,
  apexStrategy: ApexStrategy | null,
): InstructionSet["kind"] {
  if (hint === "subdomain") return "cname_subdomain";
  switch (apexStrategy) {
    case "cname_flatten":
      return "cname_apex_flatten";
    case "alias":
      return "apex_alias";
    case "www_redirect":
      return "apex_url_forward";
    case "switch_to_cf":
    default:
      return "cname_apex_flatten"; // after they switch
  }
}
