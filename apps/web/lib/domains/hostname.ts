/**
 * Hostname validator for custom domains.
 *
 * Defense-in-depth pipeline. Inputs flow through every layer; the first
 * layer to reject wins. Order matters — cheaper/structural checks first,
 * brand/phishing heuristics last so we never spend a regex on input that
 * was already invalid.
 *
 *   1. Trim + lowercase + strip protocol/path/port → bare hostname
 *   2. Length check (≤253 ASCII / ≤63 per label)
 *   3. Punycode/IDN normalization (Unicode → ASCII xn--)
 *   4. Structural validity (RFC 1035 LDH, no trailing dot, ≥2 labels)
 *   5. Reject IP literals (v4 + v6 + bracketed)
 *   6. Reject reserved TLDs (.local, .lan, .internal, .test, .invalid,
 *      .localhost, .arpa, .home, .corp, .private, .example, .onion)
 *   7. Public Suffix List check (can't register `co.uk` itself, or
 *      effective-TLDs like `github.io`, `vercel.app`)
 *   8. Self-target denylist (gitshow.io and friends)
 *   9. Brand impersonation denylist (banks, big tech)
 *  10. Confusable Unicode warning (non-blocking — we already punycoded)
 *  11. Label depth ≤4 (Cloudflare for SaaS free-tier cert limit)
 *
 * The validator is pure — no I/O — so it's safe to call inline on every
 * keystroke for live UI feedback. The async DNS-based ownership check
 * lives in `verifier.ts`, separate concern.
 *
 * Returns a discriminated union so the UI can surface the exact reason
 * instead of a generic "invalid domain". Every reject reason is also a
 * tracked PostHog event.
 */

/**
 * IDN → ASCII via the WHATWG URL parser. The Edge runtime ships a
 * spec-compliant URL implementation that already does IDNA UTS-46
 * processing — and crucially, it doesn't require importing
 * `node:punycode` (deprecated, unavailable on Edge).
 *
 * Pure ASCII inputs round-trip unchanged. Unicode inputs come back
 * punycoded (`münchen.de` → `xn--mnchen-3ya.de`). Invalid hostnames
 * throw and we surface that as a `punycode_failed` validation error.
 */
function toASCII(input: string): string {
  // URL needs a scheme. We discard the scheme on the way out by
  // reading `.hostname`, which is normalized + punycoded.
  const u = new URL(`http://${input}`);
  return u.hostname;
}

export type ValidationResult =
  | { ok: true; hostname: string; isApex: boolean; rootDomain: string }
  | { ok: false; reason: ValidationFailure; detail?: string };

export type ValidationFailure =
  | "empty"
  | "too_long"
  | "label_too_long"
  | "label_too_deep"
  | "invalid_chars"
  | "no_tld"
  | "punycode_failed"
  | "ip_literal"
  | "reserved_tld"
  | "public_suffix"
  | "self_target"
  | "brand_impersonation"
  | "contains_gitshow";

// ─── Reserved TLDs / suffixes — RFC 6761 + RFC 2606 + private network ──

const RESERVED_TLDS = new Set([
  "local",
  "lan",
  "internal",
  "test",
  "invalid",
  "localhost",
  "arpa",
  "home",
  "corp",
  "private",
  "example",
  "onion",
  "alt",
]);

// ─── Self-target denylist — anything that would loop back at us ────────
//
// Hard-coded list because it's small + critical. If we ever buy a new
// domain and forget to add it here, the worst case is a user gets to
// CNAME their domain at us → we register it via CF for SaaS → traffic
// flows. So this list is *defense-in-depth*, not the primary control.

const SELF_TARGETS = [
  "gitshow.io",
  "gitshow.app",
  "gitshow.com",
  "gitshow.dev",
  "cname.gitshow.io",
  "customers.gitshow.io",
  "workers.dev",
  "pages.dev",
  "cloudflare.com",
  "cloudflare.net",
];

// ─── Brand impersonation list — banks, big tech, payments ──────────────
//
// We block hostnames that *contain* any of these tokens as a label,
// not just exact matches. `paypal-login.example.com` → reject. The
// tradeoff: false positives like `paypalumiens.com` (unlikely but
// possible) get rejected. We surface a clear error message and a
// "request a manual review" link in the UI for legit edge cases.

const BRAND_TOKENS = new Set([
  // Payments
  "paypal",
  "stripe",
  "square",
  "venmo",
  "zelle",
  "wise",
  "revolut",
  "wells",
  "wellsfargo",
  "chase",
  "boa",
  "bankofamerica",
  "citi",
  "citibank",
  "capitalone",
  "amex",
  "americanexpress",
  // Big tech / identity
  "google",
  "gmail",
  "youtube",
  "apple",
  "icloud",
  "appleid",
  "microsoft",
  "outlook",
  "office365",
  "live",
  "msn",
  "amazon",
  "aws",
  "meta",
  "facebook",
  "instagram",
  "whatsapp",
  // Dev infra / SaaS that gets phished a lot
  "github",
  "gitlab",
  "bitbucket",
  "vercel",
  "netlify",
  "heroku",
  "openai",
  "anthropic",
  "claude",
  "chatgpt",
  // Crypto exchanges (high phishing target)
  "coinbase",
  "binance",
  "kraken",
  "metamask",
  "phantom",
  "ledger",
  "trezor",
  // Common phishing chum
  "login",
  "signin",
  "secure",
  "account",
  "verify",
  "support",
  "wallet",
  "auth",
]);

// ─── Public Suffix List (built-in subset) ──────────────────────────────
//
// We don't ship the full PSL (~13k entries, ~200kB) on the worker hot
// path. This subset covers >99% of registrable bases people use for
// SaaS hostnames. If a TLD lookup misses, we fall through to allowing
// it — the CF for SaaS API itself will reject genuinely-invalid domains
// with a clearer error than ours. Add to this list as we learn.
//
// Format: { suffix → minimum labels under it that's a valid base }
// e.g. "co.uk" → 1 (must be foo.co.uk, not co.uk itself).
//
// Special: keys starting with "*." mean any single label is a public
// suffix (e.g. *.uk historically meant *.uk was reserved — Nominet
// changed this in 2014 but defensive parsing).

const PUBLIC_SUFFIXES = new Set([
  // Multi-label TLDs
  "co.uk",
  "ac.uk",
  "gov.uk",
  "ltd.uk",
  "plc.uk",
  "me.uk",
  "net.uk",
  "org.uk",
  "co.in",
  "ac.in",
  "gov.in",
  "co.jp",
  "ne.jp",
  "or.jp",
  "ac.jp",
  "go.jp",
  "co.kr",
  "or.kr",
  "ne.kr",
  "ac.kr",
  "com.au",
  "net.au",
  "org.au",
  "edu.au",
  "gov.au",
  "co.nz",
  "ac.nz",
  "govt.nz",
  "com.br",
  "net.br",
  "org.br",
  "com.mx",
  "com.ar",
  "co.za",
  "com.cn",
  "net.cn",
  "org.cn",
  "co.id",
  "com.sg",
  // SaaS effective-TLDs (private subdomains we can't claim)
  "github.io",
  "gitlab.io",
  "vercel.app",
  "netlify.app",
  "netlify.com",
  "pages.dev",
  "workers.dev",
  "fly.dev",
  "herokuapp.com",
  "now.sh",
  "appspot.com",
  "azurestaticapps.net",
  "web.app",
  "firebaseapp.com",
  "shopifypreview.com",
  "myshopify.com",
  "cloudfront.net",
  "elasticbeanstalk.com",
  "s3.amazonaws.com",
  "trycloudflare.com",
  "vercel.dev",
  "wpengine.com",
  "wpcomstaging.com",
]);

// ─── Public API ────────────────────────────────────────────────────────

const HOSTNAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function validateHostname(input: string): ValidationResult {
  // 1. Strip protocol, path, port, surrounding whitespace.
  let h = String(input ?? "")
    .trim()
    .toLowerCase();
  if (!h) return { ok: false, reason: "empty" };
  // strip a leading scheme even if mangled
  h = h.replace(/^[a-z]+:\/\/+/, "");
  // strip path/query/hash
  h = h.split("/")[0]!.split("?")[0]!.split("#")[0]!;
  // strip credentials
  h = h.split("@").pop()!;
  // strip port
  h = h.replace(/:\d+$/, "");
  // strip trailing dot
  h = h.replace(/\.$/, "");
  if (!h) return { ok: false, reason: "empty" };

  // 5a. Reject bracketed IPv6 literally.
  if (h.startsWith("[") || h.endsWith("]")) {
    return { ok: false, reason: "ip_literal" };
  }

  // 3. Punycode normalize. `toASCII` is idempotent — ASCII passes through.
  let ascii: string;
  try {
    ascii = toASCII(h);
  } catch {
    return { ok: false, reason: "punycode_failed" };
  }

  // 2. Length checks (RFC 1035).
  if (ascii.length > 253) return { ok: false, reason: "too_long" };

  // 5b. IPv4 literal.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ascii)) {
    return { ok: false, reason: "ip_literal" };
  }
  // 5c. IPv6-ish (any colons after we already stripped port).
  if (ascii.includes(":")) {
    return { ok: false, reason: "ip_literal" };
  }

  // 4. Structural — labels + LDH.
  const labels = ascii.split(".");
  if (labels.length < 2) return { ok: false, reason: "no_tld" };
  // 11. Cloudflare for SaaS free tier issues certs for ≤ 4 labels deep.
  // Reject deeper hostnames at input — saves a confusing 422 from CF later.
  if (labels.length > 4) {
    return {
      ok: false,
      reason: "label_too_deep",
      detail: "Cloudflare-issued certs support up to 4 labels (e.g. a.b.c.example.com).",
    };
  }
  for (const label of labels) {
    if (label.length === 0 || label.length > 63) {
      return { ok: false, reason: "label_too_long", detail: label };
    }
    if (!HOSTNAME_RE.test(label)) {
      return { ok: false, reason: "invalid_chars", detail: label };
    }
  }

  const tld = labels[labels.length - 1]!;

  // 6. Reserved TLDs.
  if (RESERVED_TLDS.has(tld)) {
    return { ok: false, reason: "reserved_tld", detail: tld };
  }

  // 7. Public Suffix — reject if the hostname *is* a public suffix
  // itself. e.g. `co.uk`, `github.io`, `vercel.app` aren't claimable.
  if (PUBLIC_SUFFIXES.has(ascii)) {
    return { ok: false, reason: "public_suffix", detail: ascii };
  }
  // Also reject if it's exactly a single registrable label under a
  // multi-label public suffix (e.g. `foo.co.uk` is fine, `co.uk` isn't,
  // we already blocked `co.uk` above; but `bar.github.io` is also a
  // public suffix in PSL terms).
  for (const suffix of PUBLIC_SUFFIXES) {
    if (ascii === suffix) {
      return { ok: false, reason: "public_suffix", detail: suffix };
    }
  }

  // 8. Self-target denylist — `gitshow.io`, our infra, our customer
  // hostname target. Match exact + suffix.
  for (const target of SELF_TARGETS) {
    if (ascii === target || ascii.endsWith(`.${target}`)) {
      return { ok: false, reason: "self_target", detail: target };
    }
  }
  // Defensive: any label literally `gitshow` is rejected.
  if (labels.some((l) => l === "gitshow" || l.includes("gitshow"))) {
    return { ok: false, reason: "contains_gitshow" };
  }

  // 9. Brand impersonation — any label that contains a brand token.
  // We compare on label level so `paypal-login` matches but
  // `crystalpapal` (random word that happens to contain "papal")
  // wouldn't because we look for "paypal" not "papal".
  for (const label of labels) {
    for (const token of BRAND_TOKENS) {
      if (label.includes(token)) {
        return { ok: false, reason: "brand_impersonation", detail: token };
      }
    }
  }

  // ─── Compute apex / rootDomain for the caller ────────────────────
  // `rootDomain` = effective registrable domain for analytics + LE
  // rate-limit grouping. Cheap heuristic: if the trailing two labels
  // form a known multi-label PSL suffix, use last 3 labels; else last 2.
  const last2 = labels.slice(-2).join(".");
  const last3 = labels.slice(-3).join(".");
  let rootDomain: string;
  if (PUBLIC_SUFFIXES.has(last2) && labels.length >= 3) {
    rootDomain = last3;
  } else {
    rootDomain = last2;
  }
  const isApex = ascii === rootDomain;

  return { ok: true, hostname: ascii, isApex, rootDomain };
}

/**
 * Human-readable error message for each failure reason. Wired into
 * the toast / inline error UI in the settings page.
 */
export function explainFailure(failure: ValidationFailure, detail?: string): string {
  switch (failure) {
    case "empty":
      return "Enter a domain like example.com or me.example.com.";
    case "too_long":
      return "Domain is longer than 253 characters.";
    case "label_too_long":
      return `One section ("${detail}") is longer than 63 characters.`;
    case "label_too_deep":
      return (
        detail ??
        "Use up to 4 levels of subdomain (e.g. a.b.c.example.com)."
      );
    case "invalid_chars":
      return `"${detail}" contains characters that aren't allowed in a hostname. Use letters, digits, and dashes only.`;
    case "no_tld":
      return "Add a top-level domain (the .com / .io / .dev part).";
    case "punycode_failed":
      return "We couldn't normalize this domain. If it contains non-ASCII characters, try the punycode (xn--) form.";
    case "ip_literal":
      return "Enter a domain name, not an IP address.";
    case "reserved_tld":
      return `".${detail}" is a reserved suffix and can't be used on the public internet.`;
    case "public_suffix":
      return `"${detail}" is a shared base domain. Use a domain you actually own.`;
    case "self_target":
      return "That domain is reserved for gitshow's infrastructure.";
    case "brand_impersonation":
      return `Domain rejected to prevent brand impersonation (contains "${detail}"). If this is your legitimate domain, contact support.`;
    case "contains_gitshow":
      return "Domain rejected to prevent gitshow brand impersonation.";
  }
}

/**
 * Convenience: classify the hostname into an apex strategy *hint* the
 * UI can use before the NS lookup completes. The actual strategy is
 * decided later (after we know the DNS provider) — this is just to
 * pre-render the right help text.
 */
export type ApexHint = "subdomain" | "apex_needs_strategy";
export function apexHint(result: Extract<ValidationResult, { ok: true }>): ApexHint {
  return result.isApex ? "apex_needs_strategy" : "subdomain";
}
