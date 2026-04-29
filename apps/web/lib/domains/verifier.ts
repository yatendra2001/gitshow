/**
 * DNS verification for custom domains.
 *
 * Two checks happen here:
 *
 *   1. resolveCname(hostname) — does the hostname's CNAME chain
 *      eventually land on `cname.gitshow.io`? Used to confirm the
 *      user has set up their CNAME (or that the CF for SaaS pre-
 *      validation can succeed).
 *
 *   2. resolveTxt(name) — does the verification TXT record exist
 *      at `_cf-custom-hostname.{hostname}` with the expected value?
 *      Used by the pre-validation phase before CF for SaaS will
 *      issue a cert.
 *
 *   3. resolveApexRedirect(hostname) — does GET on the apex hostname
 *      return a 301/302 to https://www.{hostname}? Used for the
 *      www_redirect apex strategy.
 *
 * Security: every check goes through THREE resolvers in parallel —
 * Cloudflare 1.1.1.1, Google 8.8.8.8, Quad9 9.9.9.9 — and we require
 * 2/3 quorum before declaring a record "seen". This defends against:
 *   - BGP hijacks of a single resolver
 *   - Stale negative caches
 *   - Resolver misconfigurations
 *
 * All resolvers expose DNS-over-HTTPS so we don't need a UDP DNS
 * client (which the Workers runtime doesn't support).
 */

const DOH_RESOLVERS: Array<{ name: string; url: (q: string, t: string) => string; headers?: Record<string, string> }> = [
  {
    name: "cloudflare",
    url: (q, t) => `https://1.1.1.1/dns-query?name=${encodeURIComponent(q)}&type=${t}`,
    headers: { accept: "application/dns-json" },
  },
  {
    name: "google",
    url: (q, t) => `https://dns.google/resolve?name=${encodeURIComponent(q)}&type=${t}`,
    headers: { accept: "application/dns-json" },
  },
  {
    name: "quad9",
    url: (q, t) => `https://dns.quad9.net:5053/dns-query?name=${encodeURIComponent(q)}&type=${t}`,
    headers: { accept: "application/dns-json" },
  },
];

interface DohResponse {
  Status: number;
  Answer?: Array<{ name: string; type: number; data: string; TTL?: number }>;
}

const TYPE_CNAME = 5;
const TYPE_TXT = 16;
const TYPE_A = 1;
const TYPE_AAAA = 28;
const TYPE_NS = 2;

const QUORUM = 2;

async function queryAll(
  name: string,
  type: "CNAME" | "TXT" | "A" | "AAAA" | "NS",
): Promise<DohResponse[]> {
  const settled = await Promise.allSettled(
    DOH_RESOLVERS.map(async (r) => {
      const res = await fetch(r.url(name, type), {
        headers: r.headers,
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) throw new Error(`${r.name} ${res.status}`);
      return (await res.json()) as DohResponse;
    }),
  );
  return settled
    .filter((r): r is PromiseFulfilledResult<DohResponse> => r.status === "fulfilled")
    .map((r) => r.value);
}

/**
 * Returns true if at least QUORUM resolvers report a CNAME on `name`
 * that resolves (potentially through a chain) to `expectedTarget` (or
 * any apex-flatten A/AAAA glue that points at our CF edge — we accept
 * either the literal CNAME or a flattened variant).
 *
 * Apex flattening note: when a Cloudflare-hosted apex CNAME is queried,
 * the response contains the FLATTENED A records (no CNAME). To handle
 * that, we accept either:
 *   - A CNAME record literally pointing at `expectedTarget` (or its
 *     suffix e.g. `cname.gitshow.io`), OR
 *   - At least one A/AAAA record (we don't sniff specific IPs because
 *     Cloudflare's anycast pool changes; the CF for SaaS API does the
 *     authoritative routing-target check).
 */
export async function resolveCnameQuorum(
  name: string,
  expectedTarget: string,
): Promise<{ ok: boolean; matched: number; observed: string[] }> {
  const expectedTrimmed = expectedTarget.replace(/\.$/, "").toLowerCase();
  const responses = await queryAll(name, "CNAME");
  let matchedCount = 0;
  const observed: string[] = [];
  for (const r of responses) {
    if (r.Status !== 0) continue;
    const cnameHit = (r.Answer ?? []).find((a) => a.type === TYPE_CNAME);
    if (cnameHit) {
      const tgt = cnameHit.data.replace(/\.$/, "").toLowerCase();
      observed.push(tgt);
      if (tgt === expectedTrimmed || tgt.endsWith(`.${expectedTrimmed}`)) {
        matchedCount += 1;
      }
    }
  }
  // If CNAME match didn't quorum, try A/AAAA (flattened apex case).
  if (matchedCount < QUORUM) {
    const [aResponses, aaaaResponses] = await Promise.all([
      queryAll(name, "A"),
      queryAll(name, "AAAA"),
    ]);
    let flattened = 0;
    for (let i = 0; i < DOH_RESOLVERS.length; i++) {
      const a = aResponses[i];
      const aaaa = aaaaResponses[i];
      const has =
        ((a?.Answer ?? []).some((rr) => rr.type === TYPE_A) ||
          (aaaa?.Answer ?? []).some((rr) => rr.type === TYPE_AAAA));
      if (has) flattened += 1;
    }
    if (flattened >= QUORUM) {
      return { ok: true, matched: flattened, observed: [...observed, `<flattened-A/AAAA>`] };
    }
  }
  return { ok: matchedCount >= QUORUM, matched: matchedCount, observed };
}

/**
 * TXT verification with quorum. Returns true if at least QUORUM
 * resolvers see the expected TXT value on `_cf-custom-hostname.{hostname}`
 * (or the explicit name we pass in).
 *
 * TXT values are returned wrapped in quotes by DoH resolvers ("foo"),
 * sometimes with embedded chunked segments ("foo" "bar" → foobar). We
 * normalize before comparison.
 */
export async function resolveTxtQuorum(
  name: string,
  expectedValue: string,
): Promise<{ ok: boolean; matched: number; observed: string[] }> {
  const expected = expectedValue.trim();
  const responses = await queryAll(name, "TXT");
  let matched = 0;
  const observed: string[] = [];
  for (const r of responses) {
    if (r.Status !== 0) continue;
    for (const a of r.Answer ?? []) {
      if (a.type !== TYPE_TXT) continue;
      const val = normalizeTxt(a.data);
      observed.push(val);
      if (val === expected) {
        matched += 1;
        break;
      }
    }
  }
  return { ok: matched >= QUORUM, matched, observed };
}

function normalizeTxt(raw: string): string {
  // DoH gives us the data string with each chunk wrapped in quotes:
  //   "v=spf1 include:..." → strip outer quotes
  //   "abc" "def"           → join across whitespace
  return raw
    .split(/\s+/)
    .map((seg) => seg.replace(/^"|"$/g, ""))
    .join("")
    .trim();
}

/**
 * For www_redirect apex strategy: confirm that GET on the apex returns
 * a redirect to https://www.{hostname}. We follow at most one hop.
 *
 * Returns true if the first response is a 301/302 with a Location
 * header that points to the www subdomain over https.
 */
export async function checkApexRedirect(
  hostname: string,
): Promise<{ ok: boolean; status: number; location: string | null }> {
  // Hostname is already the apex — just GET it. We try https first,
  // fall back to http (redirect chains often go http://example.com →
  // https://www.example.com).
  for (const scheme of ["https", "http"] as const) {
    try {
      const res = await fetch(`${scheme}://${hostname}/`, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(5000),
        // Don't follow — we want to inspect the Location ourselves.
      });
      const loc = res.headers.get("location");
      if (loc && /^https:\/\/www\./i.test(loc) && loc.toLowerCase().includes(hostname.toLowerCase())) {
        return { ok: res.status === 301 || res.status === 302, status: res.status, location: loc };
      }
      // Some basic registrars will send a 200 with an HTML meta-refresh.
      // We treat that as not-yet-redirecting; user should configure 301.
      if (res.status >= 300 && res.status < 400 && loc) {
        return { ok: false, status: res.status, location: loc };
      }
    } catch {
      // try next scheme
    }
  }
  return { ok: false, status: 0, location: null };
}

/**
 * NS lookup wrapper used by the cron's stale-NS check (was the user's
 * DNS migrated to a new provider mid-active?).
 */
export async function resolveNsQuorum(
  zone: string,
): Promise<{ ok: boolean; matched: number; observed: string[] }> {
  const responses = await queryAll(zone, "NS");
  const seen = new Set<string>();
  let cnt = 0;
  for (const r of responses) {
    if (r.Status !== 0) continue;
    const has = (r.Answer ?? []).some((a) => a.type === TYPE_NS);
    if (has) {
      cnt += 1;
      for (const a of r.Answer ?? []) {
        if (a.type === TYPE_NS) {
          seen.add(a.data.replace(/\.$/, "").toLowerCase());
        }
      }
    }
  }
  return { ok: cnt >= QUORUM, matched: cnt, observed: [...seen] };
}
