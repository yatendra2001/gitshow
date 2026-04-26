/**
 * Display helpers for the analytics dashboard cards.
 *
 * Pure functions — no hooks, no React. Both client and server components
 * import from here.
 */

export function formatCount(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 10_000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  if (n < 1_000_000) return Math.round(n / 1000) + "k";
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
}

/**
 * Country code (ISO-3166-1 alpha-2) → flag emoji via the regional
 * indicator block. "US" → 🇺🇸. Falls back to a globe glyph on bad input.
 */
export function countryFlag(code: string | null | undefined): string {
  if (!code || code.length !== 2) return "🌐";
  const A = 0x1f1e6;
  const c0 = code.toUpperCase().charCodeAt(0) - 65;
  const c1 = code.toUpperCase().charCodeAt(1) - 65;
  if (c0 < 0 || c0 > 25 || c1 < 0 || c1 > 25) return "🌐";
  return String.fromCodePoint(A + c0) + String.fromCodePoint(A + c1);
}

const COUNTRY_NAMES: Record<string, string> = {
  US: "United States",
  IN: "India",
  GB: "United Kingdom",
  CA: "Canada",
  DE: "Germany",
  FR: "France",
  JP: "Japan",
  AU: "Australia",
  BR: "Brazil",
  NL: "Netherlands",
  SG: "Singapore",
  CN: "China",
  RU: "Russia",
  ES: "Spain",
  IT: "Italy",
  MX: "Mexico",
  KR: "South Korea",
  IE: "Ireland",
  SE: "Sweden",
  NO: "Norway",
  CH: "Switzerland",
  PL: "Poland",
  TR: "Turkey",
  AE: "UAE",
  IL: "Israel",
  ZA: "South Africa",
  AR: "Argentina",
  PH: "Philippines",
  ID: "Indonesia",
  VN: "Vietnam",
  TH: "Thailand",
  MY: "Malaysia",
  PK: "Pakistan",
  BD: "Bangladesh",
  EG: "Egypt",
  NG: "Nigeria",
  KE: "Kenya",
  CO: "Colombia",
  CL: "Chile",
  PT: "Portugal",
  BE: "Belgium",
  AT: "Austria",
  DK: "Denmark",
  FI: "Finland",
  CZ: "Czechia",
  GR: "Greece",
  RO: "Romania",
  HU: "Hungary",
  UA: "Ukraine",
  NZ: "New Zealand",
  TW: "Taiwan",
  HK: "Hong Kong",
};

export function countryName(code: string | null | undefined): string {
  if (!code) return "Unknown";
  return COUNTRY_NAMES[code.toUpperCase()] ?? code.toUpperCase();
}

export function faviconUrl(host: string): string {
  // DuckDuckGo's favicon proxy — no tracking, no key, hot path cached.
  return `https://icons.duckduckgo.com/ip3/${host}.ico`;
}

const REL = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const secs = Math.round(diff / 1000);
  if (secs < 60) return secs <= 5 ? "just now" : `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return REL.format(-days, "day");
  if (days < 30) return REL.format(-Math.round(days / 7), "week");
  return REL.format(-Math.round(days / 30), "month");
}

export function formatDateShort(date: string | number): string {
  const d = typeof date === "string" ? new Date(date) : new Date(date);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const REFERRER_LABELS: Record<string, string> = {
  "linkedin.com": "LinkedIn",
  "twitter.com": "Twitter",
  "x.com": "X (Twitter)",
  "github.com": "GitHub",
  "google.com": "Google",
  "duckduckgo.com": "DuckDuckGo",
  "bing.com": "Bing",
  "news.ycombinator.com": "Hacker News",
  "reddit.com": "Reddit",
  "facebook.com": "Facebook",
  "youtube.com": "YouTube",
  "instagram.com": "Instagram",
  "t.co": "Twitter",
  "lnkd.in": "LinkedIn",
};

export function prettyReferrer(host: string): string {
  return REFERRER_LABELS[host] ?? host;
}
