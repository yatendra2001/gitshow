/**
 * HTML/URL parsers used by media-fetch to discover real hero imagery
 * before falling back to a generated banner.
 *
 * Pure string munging — no network, no DOM. Runs in any environment.
 *
 * Three extractors:
 *   1. og:image / twitter:image from a project's homepage HTML
 *   2. "hero-ish" <img>/Markdown images from a GitHub README
 *   3. YouTube thumbnail from a watch / youtu.be URL
 *
 * Every function returns null/empty cleanly on non-matches so callers
 * can chain them without try/catch.
 */

// ─── og:image / twitter:image ────────────────────────────────────────

/**
 * Parse <meta property="og:image"> and <meta name="twitter:image">.
 * Prefers og:image; falls back to twitter:image. Resolves relative
 * URLs against `baseUrl` when provided.
 */
export function extractOgImage(html: string, baseUrl?: string): string | null {
  if (!html) return null;

  // property="og:image" or name="og:image" (some sites use name).
  // Also handle og:image:secure_url and the content attr on either side.
  const patterns: RegExp[] = [
    /<meta\s+[^>]*property\s*=\s*["']og:image(?::secure_url)?["'][^>]*content\s*=\s*["']([^"']+)["'][^>]*>/i,
    /<meta\s+[^>]*content\s*=\s*["']([^"']+)["'][^>]*property\s*=\s*["']og:image(?::secure_url)?["'][^>]*>/i,
    /<meta\s+[^>]*name\s*=\s*["']og:image["'][^>]*content\s*=\s*["']([^"']+)["'][^>]*>/i,
    /<meta\s+[^>]*name\s*=\s*["']twitter:image(?::src)?["'][^>]*content\s*=\s*["']([^"']+)["'][^>]*>/i,
    /<meta\s+[^>]*content\s*=\s*["']([^"']+)["'][^>]*name\s*=\s*["']twitter:image(?::src)?["'][^>]*>/i,
  ];

  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) {
      return resolveUrl(m[1].trim(), baseUrl);
    }
  }
  return null;
}

/**
 * Find "hero-ish" images in a GitHub README and return the top few.
 *
 * Signals we trust (in order):
 *   - URL path/filename contains hero|screenshot|banner|cover|preview|demo
 *   - Markdown alt text contains the same keywords
 *
 * Relative paths resolve to `raw.githubusercontent.com/{repo}/HEAD/{path}`.
 * GitHub's `raw` host serves raster bytes with no HTML wrapper, which is
 * what our downloader wants.
 */
export function extractReadmeHeroImages(
  readmeMarkdown: string,
  repoFullName: string,
): string[] {
  if (!readmeMarkdown) return [];
  const heroRe = /hero|screenshot|banner|cover|preview|demo/i;
  const hits: string[] = [];

  // Markdown: ![alt](url)  — alt may be empty, url may include (title).
  const mdImgRe = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const m of readmeMarkdown.matchAll(mdImgRe)) {
    const alt = m[1] ?? "";
    const url = (m[2] ?? "").trim();
    if (!url) continue;
    if (heroRe.test(url) || heroRe.test(alt)) {
      hits.push(absolutizeReadmeUrl(url, repoFullName));
    }
  }

  // HTML: <img src="..." alt="..."> — attrs can be in any order.
  const htmlImgRe = /<img\b[^>]*>/gi;
  for (const m of readmeMarkdown.matchAll(htmlImgRe)) {
    const tag = m[0];
    const srcMatch = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
    const altMatch = tag.match(/\balt\s*=\s*["']([^"']*)["']/i);
    const src = srcMatch?.[1]?.trim();
    const alt = altMatch?.[1] ?? "";
    if (!src) continue;
    if (heroRe.test(src) || heroRe.test(alt)) {
      hits.push(absolutizeReadmeUrl(src, repoFullName));
    }
  }

  // De-dup preserving order; cap at 3.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of hits) {
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
    if (out.length >= 3) break;
  }
  return out;
}

/**
 * Extract a YouTube video id from a watch URL / youtu.be URL / embed
 * URL, and return its `maxresdefault` thumbnail URL. Returns null for
 * non-YouTube inputs.
 */
export function extractYouTubeThumbnail(url: string): string | null {
  if (!url) return null;
  let id: string | null = null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      id = u.pathname.split("/").filter(Boolean)[0] ?? null;
    } else if (host === "youtube.com" || host === "m.youtube.com") {
      if (u.pathname === "/watch") {
        id = u.searchParams.get("v");
      } else if (u.pathname.startsWith("/embed/")) {
        id = u.pathname.slice("/embed/".length).split("/")[0] ?? null;
      } else if (u.pathname.startsWith("/shorts/")) {
        id = u.pathname.slice("/shorts/".length).split("/")[0] ?? null;
      }
    }
  } catch {
    return null;
  }
  if (!id) return null;
  // Basic sanity: YouTube ids are 11 chars [A-Za-z0-9_-].
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
  return `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;
}

// ─── helpers ─────────────────────────────────────────────────────────

function resolveUrl(value: string, base?: string): string {
  if (!value) return value;
  if (/^(https?:|data:)/i.test(value)) return value;
  if (value.startsWith("//")) return `https:${value}`;
  if (!base) return value;
  try {
    return new URL(value, base).toString();
  } catch {
    return value;
  }
}

function absolutizeReadmeUrl(value: string, repoFullName: string): string {
  if (/^(https?:|data:)/i.test(value)) return value;
  if (value.startsWith("//")) return `https:${value}`;
  // Strip leading ./ and /
  const clean = value.replace(/^\.\//, "").replace(/^\//, "");
  return `https://raw.githubusercontent.com/${repoFullName}/HEAD/${clean}`;
}
