/**
 * Per-request visitor enrichment for the /app analytics dashboard.
 *
 * - hashVisitor: opaque sha256 of (salt + ip + ua). Stable per visitor,
 *   non-reversible. Salt rotates with AUTH_SECRET so leaked dumps are
 *   useless after a key rotation.
 * - parseUserAgent: lightweight regex classification (device / browser /
 *   os). We deliberately do NOT pull ua-parser-js (~80kB) — three regex
 *   buckets give the dashboard signal it needs without the weight.
 * - normalizeReferrer: returns just the host so "linkedin.com/feed" and
 *   "linkedin.com/in/foo" both group as "linkedin.com" in the top-source
 *   list. Same-origin referrers (your own portfolio) are filtered out.
 */

export interface ParsedUA {
  device: "desktop" | "mobile" | "tablet" | "bot";
  browser: string;
  os: string;
}

export function parseUserAgent(ua: string | null): ParsedUA {
  if (!ua) return { device: "desktop", browser: "Unknown", os: "Unknown" };

  const lower = ua.toLowerCase();

  if (
    /bot|crawler|spider|crawling|facebookexternalhit|slackbot|discordbot|whatsapp|telegram|preview/i.test(
      ua,
    )
  ) {
    return { device: "bot", browser: "Bot", os: "Bot" };
  }

  let device: ParsedUA["device"] = "desktop";
  if (/ipad|tablet/i.test(ua)) device = "tablet";
  else if (/mobi|android|iphone/i.test(ua)) device = "mobile";

  let browser = "Other";
  if (/edg\//i.test(ua)) browser = "Edge";
  else if (/chrome\//i.test(ua) && !/edg\//i.test(ua)) browser = "Chrome";
  else if (/firefox\//i.test(ua)) browser = "Firefox";
  else if (/safari\//i.test(ua) && !/chrome\//i.test(ua)) browser = "Safari";
  else if (/opera|opr\//i.test(ua)) browser = "Opera";

  let os = "Other";
  if (/windows/i.test(ua)) os = "Windows";
  else if (/mac os x|macintosh/i.test(ua)) os = "macOS";
  else if (/iphone|ipad|ipod/i.test(ua)) os = "iOS";
  else if (/android/i.test(ua)) os = "Android";
  else if (/linux/i.test(ua)) os = lower.includes("cros") ? "Chrome OS" : "Linux";

  return { device, browser, os };
}

export function normalizeReferrer(
  referer: string | null,
  selfHost: string | null,
): { host: string | null; url: string | null } {
  if (!referer) return { host: null, url: null };
  try {
    const u = new URL(referer);
    if (selfHost && u.host === selfHost) return { host: null, url: null };
    const host = u.host.replace(/^www\./, "");
    return { host, url: referer.slice(0, 512) };
  } catch {
    return { host: null, url: null };
  }
}

/**
 * sha256 hex of (salt + ip + ua), truncated to 24 hex chars (12 bytes
 * — plenty of entropy for our scale, 1 in ~2^48 collision per profile).
 * Stable per visitor as long as the salt + ip + ua tuple is stable.
 *
 * Behind a CG-NAT or shared corporate IP, multiple users with identical
 * UAs may collide. That's acceptable for a portfolio analytics dashboard;
 * we lean conservative on uniques rather than over-counting.
 */
export async function hashVisitor(
  salt: string,
  ip: string,
  ua: string,
): Promise<string> {
  const data = new TextEncoder().encode(`${salt}::${ip}::${ua}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(buf).slice(0, 12);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Pulls country / region / city out of the Cloudflare-injected request
 * properties. Locally (no `req.cf`) we get nulls — render the dashboard
 * accordingly.
 */
export function geoFromRequest(req: Request): {
  country: string | null;
  region: string | null;
  city: string | null;
} {
  const cf = (req as Request & { cf?: Record<string, string | undefined> }).cf;
  if (!cf) return { country: null, region: null, city: null };
  return {
    country: cf.country ?? null,
    region: cf.region ?? null,
    city: cf.city ?? null,
  };
}

/**
 * Best-effort client IP. Cloudflare always sets `cf-connecting-ip`;
 * everything else is fallback for local dev / proxies.
 */
export function clientIp(req: Request): string {
  const h = req.headers;
  return (
    h.get("cf-connecting-ip") ??
    h.get("x-real-ip") ??
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "0.0.0.0"
  );
}
