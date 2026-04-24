/**
 * Logo / favicon helpers used by media-fetch for Company + School nodes.
 *
 * Two hosted sources in priority order:
 *   1. Clearbit Logo API — clean, vector-y, consistent; misses long-tail.
 *   2. Google favicon — always works but tiny / noisy.
 *
 * `downloadFirstAvailable` does a fetch-per-URL in order and returns the
 * first one that responds with a reasonable payload. We deliberately
 * don't HEAD first (Clearbit returns 404 with a JSON body; Google
 * redirects 302 to a default). A single GET with a short timeout is
 * both simpler and faster.
 */

export function clearbitLogoUrl(domain: string): string {
  return `https://logo.clearbit.com/${normalizeDomain(domain)}`;
}

export function googleFaviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(
    normalizeDomain(domain),
  )}&sz=128`;
}

function normalizeDomain(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split("/")[0]!
    .toLowerCase();
}

/**
 * Try each URL in order, return the first one that returns image bytes.
 * Returns null when none succeed.
 *
 * We treat a successful fetch with > 200 bytes as "got it"; the Google
 * favicon default is a 6x6 stub ~130 bytes, which the caller probably
 * doesn't want to promote to a logo.
 */
export async function downloadFirstAvailable(
  urls: string[],
  opts: { timeoutMs?: number } = {},
): Promise<{ url: string; bytes: Uint8Array; contentType: string } | null> {
  const timeoutMs = opts.timeoutMs ?? 8000;

  for (const url of urls) {
    const got = await tryDownload(url, timeoutMs);
    if (got) return got;
  }
  return null;
}

async function tryDownload(
  url: string,
  timeoutMs: number,
): Promise<{ url: string; bytes: Uint8Array; contentType: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
    });
    if (!resp.ok) return null;

    const contentType = resp.headers.get("content-type") ?? "image/png";
    // Some logo APIs return HTML error pages with 200. Guard against it.
    if (!/^image\//i.test(contentType)) return null;

    const buf = await resp.arrayBuffer();
    if (buf.byteLength < 200) return null;

    return {
      url,
      bytes: new Uint8Array(buf),
      contentType,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
