/**
 * Media fetch — the tiered pipeline that attaches real imagery (or a
 * generated banner) to Projects, Companies, and Schools in the KG.
 *
 * Flow per §8.1 of session-8-plan:
 *
 *   Projects (ordered, first success wins):
 *     1. homepageUrl → TinyFish fetch → og:image
 *     2. README → first "hero-ish" image
 *     3. any source URL is YouTube → maxresdefault.jpg
 *     4. shouldFeature && all above missed → Gemini Flash Image banner
 *     5. none of the above → emit NO edge (render layer does initials)
 *
 *   Companies + Schools with a known domain:
 *     1. Clearbit logo → Google favicon
 *     2. On any hit, resize to 128×128 WebP, upload, emit HAS_MEDIA
 *     3. On all misses, emit NO edge
 *
 * Everything is best-effort. One failed project/company never blocks
 * the rest. Every attempted download emits a trace event; the audit
 * script can reconstruct exactly why a given user's portfolio has or
 * doesn't have media.
 *
 * R2 layout:
 *   media/{handle}/projects/{projectId}/hero.webp
 *   media/{handle}/projects/{projectId}/hero-generated.webp
 *   media/{handle}/companies/{domainSlug}/logo.webp
 *   media/{handle}/schools/{domainSlug}/logo.webp
 */

import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import {
  edgeId,
  makeSource,
  mediaAssetId,
  slug,
  type Edge,
  type KnowledgeGraph,
  type MediaAsset,
  type Project,
} from "@gitshow/shared/kg";
import { TinyFishClient } from "@gitshow/shared/cloud/tinyfish";
import type { ScanTrace } from "../observability/trace.js";
import { resizeToWebP } from "./image-resize.js";
import {
  extractOgImage,
  extractReadmeHeroImages,
  extractYouTubeThumbnail,
} from "./og-image.js";
import {
  clearbitLogoUrl,
  downloadFirstAvailable,
  googleFaviconUrl,
} from "./clearbit.js";
import { generateProjectBanner } from "./banner-gen.js";

// ─── Public API ──────────────────────────────────────────────────────

export interface MediaFetchOptions {
  trace?: ScanTrace;
  r2?: {
    client: S3Client;
    bucket: string;
    /** User handle — becomes the R2 prefix `media/{handle}/...`. */
    handle: string;
  };
  /** Scan ID — passed as OpenRouter session_id on banner-gen calls so
   *  image generation shows up in the same session as everything else. */
  scanId?: string;
}

export async function fetchMediaForKG(
  kg: KnowledgeGraph,
  opts: MediaFetchOptions = {},
): Promise<KnowledgeGraph> {
  const tinyfish = TinyFishClient.fromEnv();
  const handle = opts.r2?.handle ?? kg.meta.handle ?? "unknown";

  for (const project of kg.entities.projects) {
    await attachProjectHero(kg, project, {
      trace: opts.trace,
      tinyfish,
      r2: opts.r2,
      handle,
      scanId: opts.scanId,
    });
  }

  for (const company of kg.entities.companies) {
    // Used to skip when domain was missing — but ProxyCurl-sourced
    // companies often have no clean domain yet a perfectly good
    // first-party logo URL. Try the entity's logoUrl first, then fall
    // through to Clearbit/favicon when we also have a domain.
    if (!company.domain && !company.logoUrl) continue;
    await attachLogo(kg, {
      ownerId: company.id,
      name: company.canonicalName,
      domain: company.domain,
      preferredLogoUrl: company.logoUrl,
      r2Prefix: "companies",
      trace: opts.trace,
      r2: opts.r2,
      handle,
    });
  }

  for (const school of kg.entities.schools) {
    if (!school.domain && !school.logoUrl) continue;
    await attachLogo(kg, {
      ownerId: school.id,
      name: school.canonicalName,
      domain: school.domain,
      preferredLogoUrl: school.logoUrl,
      r2Prefix: "schools",
      trace: opts.trace,
      r2: opts.r2,
      handle,
    });
  }

  return kg;
}

// ─── Project hero ────────────────────────────────────────────────────

interface ProjectCtx {
  trace?: ScanTrace;
  tinyfish: TinyFishClient | null;
  r2?: MediaFetchOptions["r2"];
  handle: string;
  /** Scan id — flows down into banner-gen as OpenRouter session_id. */
  scanId?: string;
}

type HeroOrigin = MediaAsset["origin"];

async function attachProjectHero(
  kg: KnowledgeGraph,
  project: Project,
  ctx: ProjectCtx,
): Promise<void> {
  // Tier 1 — homepage og:image.
  const homepageUrl = project.homepageUrl ?? findRepoHomepage(kg, project);
  if (homepageUrl) {
    const hit = await tryHomepageOgImage(homepageUrl, ctx);
    if (hit) {
      await finalizeHero(kg, project, hit, "og", ctx);
      return;
    }
  }

  // Tier 2 — README hero image.
  if (project.repoFullName) {
    const hit = await tryReadmeHero(project.repoFullName, ctx);
    if (hit) {
      await finalizeHero(kg, project, hit, "readme", ctx);
      return;
    }
  }

  // Tier 3 — YouTube thumbnail (scan project source URLs).
  const ytUrl = findYoutubeUrl(kg, project);
  if (ytUrl) {
    const thumb = extractYouTubeThumbnail(ytUrl);
    if (thumb) {
      const hit = await downloadImage(thumb, ctx.trace, "project-hero", "youtube");
      if (hit) {
        await finalizeHero(kg, project, { ...hit, sourceUrl: thumb }, "youtube", ctx);
        return;
      }
    }
  }

  // Tier 4 — generated banner (featured projects only).
  if (project.shouldFeature) {
    const gen = await generateProjectBanner({
      project: {
        id: project.id,
        title: project.title,
        purpose: project.purpose,
        tags: project.tags,
        kind: project.kind,
      },
      scanId: ctx.scanId,
      trace: ctx.trace,
    });
    if (gen) {
      await finalizeHero(
        kg,
        project,
        { bytes: gen.bytes, contentType: gen.contentType, sourceUrl: "generated" },
        "generated",
        ctx,
      );
      return;
    }
  }

  // Tier 5 — no media. Render layer paints initials.
}

async function tryHomepageOgImage(
  homepageUrl: string,
  ctx: ProjectCtx,
): Promise<{ bytes: Uint8Array; contentType: string; sourceUrl: string } | null> {
  if (!ctx.tinyfish) return null;
  const startedAt = Date.now();
  const fetched = await ctx.tinyfish.fetchUrls([homepageUrl], { format: "html" });
  if (!fetched.ok || fetched.results.length === 0) {
    ctx.trace?.mediaDownload({
      mediaKind: "project-hero",
      url: homepageUrl,
      ok: false,
      durationMs: Date.now() - startedAt,
      origin: "og",
      error: fetched.requestError ?? "tinyfish_empty",
    });
    return null;
  }
  const html = fetched.results[0]?.text ?? "";
  const ogUrl = extractOgImage(html, homepageUrl);
  if (!ogUrl) {
    ctx.trace?.mediaDownload({
      mediaKind: "project-hero",
      url: homepageUrl,
      ok: false,
      durationMs: Date.now() - startedAt,
      origin: "og",
      error: "no_og_image_tag",
    });
    return null;
  }
  const dl = await downloadImage(ogUrl, ctx.trace, "project-hero", "og");
  if (!dl) return null;
  return { ...dl, sourceUrl: ogUrl };
}

async function tryReadmeHero(
  repoFullName: string,
  ctx: ProjectCtx,
): Promise<{ bytes: Uint8Array; contentType: string; sourceUrl: string } | null> {
  const readmeUrl = `https://raw.githubusercontent.com/${repoFullName}/HEAD/README.md`;
  const startedAt = Date.now();
  let readmeText = "";
  try {
    const resp = await fetch(readmeUrl);
    if (!resp.ok) {
      ctx.trace?.mediaDownload({
        mediaKind: "project-hero",
        url: readmeUrl,
        ok: false,
        durationMs: Date.now() - startedAt,
        origin: "readme",
        error: `http_${resp.status}`,
      });
      return null;
    }
    readmeText = await resp.text();
  } catch (err) {
    ctx.trace?.mediaDownload({
      mediaKind: "project-hero",
      url: readmeUrl,
      ok: false,
      durationMs: Date.now() - startedAt,
      origin: "readme",
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  const heroes = extractReadmeHeroImages(readmeText, repoFullName);
  for (const candidate of heroes) {
    const dl = await downloadImage(candidate, ctx.trace, "project-hero", "readme");
    if (dl) return { ...dl, sourceUrl: candidate };
  }
  return null;
}

async function finalizeHero(
  kg: KnowledgeGraph,
  project: Project,
  hit: { bytes: Uint8Array; contentType: string; sourceUrl: string },
  origin: Exclude<HeroOrigin, undefined>,
  ctx: ProjectCtx,
): Promise<void> {
  const resized = await resizeToWebP(hit.bytes, {
    width: 1200,
    height: 630,
    fit: "cover",
  });
  const finalBytes = resized?.buffer ?? hit.bytes;
  const finalContentType = resized ? "image/webp" : hit.contentType;

  const filename = origin === "generated" ? "hero-generated.webp" : "hero.webp";
  const r2Key = `media/${ctx.handle}/projects/${project.id}/${filename}`;
  const uploaded = await uploadToR2(finalBytes, finalContentType, r2Key, ctx.r2);

  pushMediaEdge(kg, {
    ownerId: project.id,
    kind: "hero",
    origin,
    r2Key: uploaded ? r2Key : undefined,
    remoteUrl: uploaded ? undefined : hit.sourceUrl,
    width: resized?.width,
    height: resized?.height,
    fetcherLabel: "media-fetch",
  });
}

// ─── Company / School logo ───────────────────────────────────────────

async function attachLogo(
  kg: KnowledgeGraph,
  args: {
    ownerId: string;
    name: string;
    /** Optional — used to compose Clearbit / favicon fallback URLs. */
    domain?: string;
    /**
     * First-party logo URL (e.g. ProxyCurl/EnrichLayer's `logo_url`
     * from a LinkedIn experience). Tried before Clearbit because
     * LinkedIn-hosted brand assets are sharper and have far better
     * coverage of the long-tail companies Clearbit doesn't know.
     */
    preferredLogoUrl?: string;
    r2Prefix: "companies" | "schools";
    trace?: ScanTrace;
    r2?: MediaFetchOptions["r2"];
    handle: string;
  },
): Promise<void> {
  const urls: string[] = [];
  if (args.preferredLogoUrl) urls.push(args.preferredLogoUrl);
  if (args.domain) {
    urls.push(clearbitLogoUrl(args.domain), googleFaviconUrl(args.domain));
  }
  if (urls.length === 0) return;
  const startedAt = Date.now();
  const got = await downloadFirstAvailable(urls, { timeoutMs: 8000 });

  if (!got) {
    args.trace?.mediaDownload({
      mediaKind: `${args.r2Prefix === "companies" ? "company" : "school"}-logo`,
      url: urls[0],
      ok: false,
      durationMs: Date.now() - startedAt,
      origin: args.preferredLogoUrl ? "linkedin" : "clearbit",
      error: "all_sources_failed",
    });
    return;
  }

  const origin: HeroOrigin =
    args.preferredLogoUrl && got.url === args.preferredLogoUrl
      ? "linkedin"
      : got.url.includes("logo.clearbit.com")
        ? "clearbit"
        : "favicon";

  args.trace?.mediaDownload({
    mediaKind: `${args.r2Prefix === "companies" ? "company" : "school"}-logo`,
    url: got.url,
    ok: true,
    bytes: got.bytes.byteLength,
    origin: origin ?? undefined,
    durationMs: Date.now() - startedAt,
  });

  const resized = await resizeToWebP(got.bytes, {
    width: 128,
    height: 128,
    fit: "contain",
  });
  const finalBytes = resized?.buffer ?? got.bytes;
  const finalContentType = resized ? "image/webp" : got.contentType;

  // Slug for the R2 key — prefer the domain when available, otherwise
  // derive from the canonical entity name so two companies without a
  // domain don't collide on the same path.
  const slugSource =
    args.domain?.replace(/^https?:\/\//, "").replace(/^www\./, "") ?? args.name;
  const r2Key = `media/${args.handle}/${args.r2Prefix}/${slug(slugSource)}/logo.webp`;
  const uploaded = await uploadToR2(finalBytes, finalContentType, r2Key, args.r2);

  pushMediaEdge(kg, {
    ownerId: args.ownerId,
    kind: "logo",
    origin,
    r2Key: uploaded ? r2Key : undefined,
    remoteUrl: uploaded ? undefined : got.url,
    width: resized?.width,
    height: resized?.height,
    fetcherLabel: "media-fetch",
  });
}

// ─── shared helpers ──────────────────────────────────────────────────

async function downloadImage(
  url: string,
  trace: ScanTrace | undefined,
  mediaKind: string,
  origin: string,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const startedAt = Date.now();
  try {
    const resp = await fetch(url, { redirect: "follow" });
    if (!resp.ok) {
      trace?.mediaDownload({
        mediaKind,
        url,
        ok: false,
        durationMs: Date.now() - startedAt,
        origin,
        error: `http_${resp.status}`,
      });
      return null;
    }
    const contentType = resp.headers.get("content-type") ?? "image/jpeg";
    if (!/^image\//i.test(contentType)) {
      trace?.mediaDownload({
        mediaKind,
        url,
        ok: false,
        durationMs: Date.now() - startedAt,
        origin,
        error: `non_image_content_type: ${contentType}`,
      });
      return null;
    }
    const buf = await resp.arrayBuffer();
    const bytes = new Uint8Array(buf);
    trace?.mediaDownload({
      mediaKind,
      url,
      ok: true,
      bytes: bytes.byteLength,
      durationMs: Date.now() - startedAt,
      origin,
    });
    return { bytes, contentType };
  } catch (err) {
    trace?.mediaDownload({
      mediaKind,
      url,
      ok: false,
      durationMs: Date.now() - startedAt,
      origin,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function uploadToR2(
  bytes: Uint8Array,
  contentType: string,
  key: string,
  r2?: MediaFetchOptions["r2"],
): Promise<boolean> {
  if (!r2) return false;
  try {
    await r2.client.send(
      new PutObjectCommand({
        Bucket: r2.bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
      }),
    );
    return true;
  } catch {
    return false;
  }
}

function pushMediaEdge(
  kg: KnowledgeGraph,
  args: {
    ownerId: string;
    kind: MediaAsset["kind"];
    origin: MediaAsset["origin"];
    r2Key?: string;
    remoteUrl?: string;
    width?: number;
    height?: number;
    fetcherLabel: string;
  },
): void {
  const assetId = mediaAssetId({ ownerId: args.ownerId, kind: args.kind });
  const existing = kg.entities.mediaAssets.find((m) => m.id === assetId);
  const asset: MediaAsset = {
    id: assetId,
    kind: args.kind,
    r2Key: args.r2Key,
    remoteUrl: args.remoteUrl,
    width: args.width,
    height: args.height,
    origin: args.origin,
  };
  if (existing) {
    Object.assign(existing, asset);
  } else {
    kg.entities.mediaAssets.push(asset);
  }

  const eid = edgeId({ type: "HAS_MEDIA", from: args.ownerId, to: assetId });
  if (kg.edges.some((e) => e.id === eid)) return;

  const edge: Edge = {
    id: eid,
    type: "HAS_MEDIA",
    from: args.ownerId,
    to: assetId,
    attrs: {
      origin: args.origin ?? "unknown",
    },
    sources: [
      makeSource({
        fetcher: "media-fetch",
        method: "api",
        confidence: "high",
      }),
    ],
    band: "verified",
  };
  kg.edges.push(edge);
}

function findRepoHomepage(kg: KnowledgeGraph, project: Project): string | undefined {
  if (!project.repoFullName) return undefined;
  const repo = kg.entities.repositories.find(
    (r) => r.fullName.toLowerCase() === project.repoFullName?.toLowerCase(),
  );
  return repo?.homepageUrl;
}

/**
 * Walk edges related to a project and look for a YouTube URL in
 * source URLs (a publication we AUTHORED, an achievement we WON, etc).
 */
function findYoutubeUrl(kg: KnowledgeGraph, project: Project): string | undefined {
  for (const edge of kg.edges) {
    if (edge.from !== project.id && edge.to !== project.id) continue;
    for (const s of edge.sources) {
      if (s.url && isYoutubeUrl(s.url)) return s.url;
    }
  }
  return undefined;
}

function isYoutubeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    return host === "youtu.be" || host === "youtube.com" || host === "m.youtube.com";
  } catch {
    return false;
  }
}
