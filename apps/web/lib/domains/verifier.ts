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
 * "Has the customer set up a record that's pointing at us?" — the
 * lenient gate used to decide whether we should register the hostname
 * with Cloudflare for SaaS. Cloudflare itself is the authoritative
 * judge of whether the records are correct — if they aren't (e.g.
 * stale A records to a previous host), CF returns
 * `ssl_status = validation_failed` and we surface that to the user.
 *
 * What counts as "set up":
 *   - CNAME quorum on `name` pointing at `expectedTarget` (subdomain
 *     case — DoH sees the literal CNAME).
 *   - At least one A or AAAA record at quorum (apex case — Cloudflare
 *     flattens the CNAME at the root, so DoH only ever sees A records).
 *
 * We don't HTTPS-probe at this stage because the probe can only
 * succeed AFTER Cloudflare for SaaS has registered the hostname and
 * issued a cert — which only happens AFTER we register. Chicken and
 * egg. The caller (`/api/domains/verify`) handles end-to-end
 * confirmation by polling CF SSL status; the probe is a separate
 * helper used only as a final sanity check (see `probeReachability`).
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

  // Subdomain / explicit CNAME case — pass immediately on quorum.
  if (matchedCount >= QUORUM) {
    return { ok: true, matched: matchedCount, observed };
  }

  // Apex flattening: DoH returns A/AAAA, no literal CNAME. If quorum
  // resolvers see ANY records, count it as set-up evidence. CF will
  // reject + report validation_failed if they don't actually point
  // at its edge (e.g. stale Heroku IPs left behind).
  const [aResponses, aaaaResponses] = await Promise.all([
    queryAll(name, "A"),
    queryAll(name, "AAAA"),
  ]);
  let withRecords = 0;
  for (let i = 0; i < DOH_RESOLVERS.length; i++) {
    const a = aResponses[i];
    const aaaa = aaaaResponses[i];
    const has =
      ((a?.Answer ?? []).some((rr) => rr.type === TYPE_A) ||
        (aaaa?.Answer ?? []).some((rr) => rr.type === TYPE_AAAA));
    if (has) withRecords += 1;
  }
  if (withRecords >= QUORUM) {
    return {
      ok: true,
      matched: withRecords,
      observed: [...observed, "<apex-A/AAAA>"],
    };
  }

  return { ok: false, matched: matchedCount, observed };
}

/**
 * End-to-end reachability probe. Used as a final confirmation AFTER
 * Cloudflare for SaaS reports `ssl.status = active`. Returns ok=true
 * when `https://{hostname}/.well-known/gitshow-probe` responds with
 * our exact signature — which can only happen if (a) cert is issued,
 * (b) routing is propagated to the edge, (c) middleware is letting
 * the path through.
 *
 * Treat ok=false as "still propagating, retry next poll" — never as
 * a hard failure, since CF SSL status is the source of truth and the
 * probe is just belt-and-suspenders.
 */
export async function probeReachability(
  hostname: string,
): Promise<{ ok: boolean; detail?: string }> {
  const url = `https://${hostname}/.well-known/gitshow-probe`;
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(6000),
      headers: {
        "user-agent": "gitshow-domain-verify/1.0",
      },
    });
    if (res.status !== 200) return { ok: false, detail: `http_${res.status}` };
    const body = (await res.json().catch(() => null)) as
      | { ok?: boolean; signature?: string }
      | null;
    if (!body) return { ok: false, detail: "non_json" };
    if (body.signature !== "gitshow-probe-v1") {
      return { ok: false, detail: "wrong_signature" };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return { ok: false, detail: msg.includes("timeout") ? "timeout" : "network" };
  }
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
