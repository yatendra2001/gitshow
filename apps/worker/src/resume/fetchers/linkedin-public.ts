/**
 * linkedin-public fetcher — Tier 1 (TinyFish) + Tier 2 (Jina Reader).
 *
 * Tier 1 runs TinyFish on non-`/in/` LinkedIn URLs (company pages, blog
 * posts linking to LinkedIn). `linkedin.com/in/` always login-walls — we
 * skip it to save a credit.
 *
 * Tier 2 runs Jina Reader (`https://r.jina.ai/{url}`) on everything. Works
 * on ~30% of public profiles LinkedIn exposes to search engines.
 *
 * Both tiers feed into a Kimi extraction that emits typed facts:
 * WORKED_AT, STUDIED_AT, HAS_SKILL, PERSON (bio/location).
 *
 * Returns [] when both tiers fail — the caller falls through to
 * Tier 3 (Playwright) and Tier 4 (PDF).
 */

import * as z from "zod/v4";
import { runAgentWithSubmit } from "../../agents/base.js";
import { modelForRole } from "@gitshow/shared/models";
import { TinyFishClient } from "@gitshow/shared/cloud/tinyfish";
import { makeSource } from "@gitshow/shared/kg";
import type { TypedFact } from "@gitshow/shared/kg";
import type { ScanSession } from "../../schemas.js";
import type { SessionUsage } from "../../session.js";
import type { ScanTrace } from "../observability/trace.js";

// ─── Wall-detection constants (ported from linkedin.ts) ──────────────

export const MIN_TEXT_CHARS = 800;
export const LOGIN_WALL_PATTERN =
  /sign\s*in|sign\s*up|log\s*in|login|authwall|members only|join (?:now|linkedin)|by clicking continue/i;
export const LOGIN_WALL_TITLES = /^(sign up|sign in|log in|join linkedin)/i;

const JINA_TIMEOUT_MS = 30_000;
const USER_AGENT = "GitShow/0.2 (+https://github.com/yatendrakumar/gitshow)";

// ─── Fetcher I/O ─────────────────────────────────────────────────────

export interface FetcherInput {
  session: ScanSession;
  usage: SessionUsage;
  trace?: ScanTrace;
  onProgress?: (text: string) => void;
}

// ─── Extraction schema ───────────────────────────────────────────────

const PositionSchema = z.object({
  company: z.string().max(200),
  title: z.string().max(200),
  start: z.string().max(40).optional(),
  end: z.string().max(40).optional(),
  present: z.boolean().optional(),
  location: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
});

const EducationSchema = z.object({
  school: z.string().max(200),
  degree: z.string().max(200),
  start: z.string().max(40).optional(),
  end: z.string().max(40).optional(),
  field: z.string().max(200).optional(),
});

export const LinkedInExtractionSchema = z.object({
  positions: z.array(PositionSchema).max(30),
  educations: z.array(EducationSchema).max(20),
  skills: z.array(z.string().max(80)).max(50),
  bio: z.string().max(1000).optional(),
  location: z.string().max(200).optional(),
});
export type LinkedInExtraction = z.infer<typeof LinkedInExtractionSchema>;

const SYSTEM_PROMPT = `You extract a LinkedIn profile's structured data from scraped page text.
Return typed JSON with:
- positions: experience entries (company, title, dates, location, short description verbatim)
- educations: school + degree + dates + field
- skills: top 20 skill names as short strings ("TypeScript", "Distributed Systems")
- bio: the person's headline / About paragraph (verbatim, under 1000 chars)
- location: city/region string if present

Rules:
- Extract ONLY facts stated in the text. Never invent a company.
- For "present" positions, set present=true and leave end empty.
- Skip sections that are login-wall chrome ("Sign in to see…"). If the entire text looks walled, return empty arrays.
- Dates: preserve "May 2021", "2020 - Present" verbatim as strings.

Call submit_linkedin_extraction exactly once.`;

// ─── Core fetcher ────────────────────────────────────────────────────

export async function runLinkedInPublicFetcher(
  input: FetcherInput,
): Promise<TypedFact[]> {
  const label = "linkedin-public";
  const t0 = Date.now();
  const url = input.session.socials.linkedin;
  const log = input.onProgress ?? (() => {});
  const trace = input.trace;

  trace?.fetcherStart({ label, input: { url, hasUrl: !!url } });

  if (!url) {
    trace?.fetcherEnd({
      label,
      durationMs: Date.now() - t0,
      factsEmitted: 0,
      status: "empty",
    });
    return [];
  }

  try {
    // Tier 0: ProxyCurl (paid LinkedIn API). Best path when set —
    // returns canonical structured JSON (positions/educations/skills)
    // with no LLM extraction needed. Skipped if PROXYCURL_API_KEY
    // isn't set.
    const proxyCurlFacts = await tryProxyCurl({
      url,
      session: input.session,
      label,
      trace,
      log,
    });
    if (proxyCurlFacts && proxyCurlFacts.length > 0) {
      trace?.fetcherEnd({
        label,
        durationMs: Date.now() - t0,
        factsEmitted: proxyCurlFacts.length,
        status: "ok",
      });
      return proxyCurlFacts;
    }

    // Tier 1: TinyFish (now also tried on /in/ URLs)
    const tier1Text = await tryTier1({ url, trace, log });
    // Tier 2: Jina Reader
    const tier2Text = tier1Text
      ? null
      : await tryTier2({ url, trace, log });

    const usableText = tier1Text ?? tier2Text;
    const tier = tier1Text ? 1 : tier2Text ? 2 : 0;

    if (!usableText) {
      trace?.fetcherEnd({
        label,
        durationMs: Date.now() - t0,
        factsEmitted: 0,
        status: "empty",
      });
      return [];
    }

    // LLM extraction
    const extraction = await extract({
      text: usableText,
      url,
      session: input.session,
      usage: input.usage,
      trace,
      log,
    });

    const facts = buildFacts({ extraction, url, label });

    trace?.linkedInFactsEmitted({
      tier,
      positions: extraction.positions.length,
      educations: extraction.educations.length,
      skills: extraction.skills.length,
    });
    emitFactsToTrace(trace, label, facts);

    trace?.fetcherEnd({
      label,
      durationMs: Date.now() - t0,
      factsEmitted: facts.length,
      status: facts.length > 0 ? "ok" : "empty",
    });
    return facts;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`[${label}] error: ${msg}\n`);
    trace?.fetcherError({
      label,
      error: msg,
      stack: err instanceof Error ? err.stack : undefined,
      retryable: false,
    });
    trace?.fetcherEnd({
      label,
      durationMs: Date.now() - t0,
      factsEmitted: 0,
      status: "error",
    });
    return [];
  }
}

// ─── Tier 0: ProxyCurl / EnrichLayer (paid, when configured) ────────
//
// LinkedIn's anti-bot is good enough that public-side scraping
// (TinyFish → Jina) frequently lands on a sign-up wall. ProxyCurl
// (now operating as EnrichLayer at enrichlayer.com) runs scrapes
// through residential proxies + maintains LinkedIn cookie pools,
// returning canonical JSON with experiences/education/skills/etc.
// Costs 1–2 credits/profile — trivial at this scale.
//
// Migration note: the `nubela.co/proxycurl/api/v2/linkedin` endpoint
// returns 410 Gone — they migrated to `enrichlayer.com/api/v2/profile`
// and the URL param renamed from `url` to `profile_url`. Same API key
// works on both. We point at the new endpoint here.
//
// Activation: set `PROXYCURL_API_KEY` in Fly secrets. Without it, this
// tier is a no-op and we fall through to the public chain.

interface ProxyCurlDate {
  day?: number;
  month?: number;
  year?: number;
}
interface ProxyCurlPosition {
  company?: string;
  company_linkedin_profile_url?: string;
  title?: string;
  description?: string;
  location?: string;
  logo_url?: string;
  starts_at?: ProxyCurlDate;
  ends_at?: ProxyCurlDate | null;
}
interface ProxyCurlEducation {
  school?: string;
  school_linkedin_profile_url?: string;
  degree_name?: string;
  field_of_study?: string;
  starts_at?: ProxyCurlDate;
  ends_at?: ProxyCurlDate | null;
  description?: string;
  grade?: string;
  activities_and_societies?: string;
  logo_url?: string;
}
interface ProxyCurlAccomplishmentProject {
  title?: string;
  description?: string;
  url?: string;
  starts_at?: ProxyCurlDate;
  ends_at?: ProxyCurlDate | null;
}
interface ProxyCurlHonor {
  title?: string;
  issuer?: string;
  description?: string;
  issued_on?: ProxyCurlDate;
}
interface ProxyCurlPublication {
  name?: string;
  publisher?: string;
  description?: string;
  url?: string;
  published_on?: ProxyCurlDate;
}
interface ProxyCurlCertification {
  name?: string;
  authority?: string;
  url?: string;
  display_source?: string;
  license_number?: string;
  starts_at?: ProxyCurlDate;
  ends_at?: ProxyCurlDate | null;
}
interface ProxyCurlVolunteerWork {
  title?: string;
  cause?: string;
  company?: string;
  company_linkedin_profile_url?: string;
  description?: string;
  starts_at?: ProxyCurlDate;
  ends_at?: ProxyCurlDate | null;
  logo_url?: string;
}
interface ProxyCurlProfile {
  full_name?: string;
  first_name?: string;
  last_name?: string;
  headline?: string;
  occupation?: string;
  summary?: string;
  profile_pic_url?: string;
  background_cover_image_url?: string;
  city?: string;
  state?: string;
  country?: string;
  country_full_name?: string;
  experiences?: ProxyCurlPosition[];
  education?: ProxyCurlEducation[];
  skills?: string[];
  accomplishment_projects?: ProxyCurlAccomplishmentProject[];
  accomplishment_honors_awards?: ProxyCurlHonor[];
  accomplishment_publications?: ProxyCurlPublication[];
  certifications?: ProxyCurlCertification[];
  volunteer_work?: ProxyCurlVolunteerWork[];
}

async function tryProxyCurl(args: {
  url: string;
  session: ScanSession;
  label: "linkedin-public";
  trace?: ScanTrace;
  log: (s: string) => void;
}): Promise<TypedFact[] | null> {
  const { url, label, trace, log } = args;
  const apiKey = process.env.PROXYCURL_API_KEY;
  if (!apiKey) {
    trace?.linkedInTierAttempt({
      tier: 0,
      method: "proxycurl",
      ok: false,
      durationMs: 0,
      reason: "proxycurl-no-api-key",
    });
    return null;
  }

  const isProfile = /\blinkedin\.com\/in\//i.test(url);
  if (!isProfile) {
    // EnrichLayer's profile endpoint is /in/ only; for company URLs
    // there's a separate API we don't need yet.
    return null;
  }

  const t0 = Date.now();
  log(`[${label}] tier 0 — EnrichLayer /api/v2/profile\n`);

  try {
    // EnrichLayer (formerly ProxyCurl/Nubela). The old
    // nubela.co/proxycurl/api/v2/linkedin endpoint returns 410 Gone;
    // the new endpoint takes `profile_url` instead of `url`. Same API
    // key works on both.
    const apiUrl = new URL("https://enrichlayer.com/api/v2/profile");
    apiUrl.searchParams.set("profile_url", url);
    apiUrl.searchParams.set("skills", "include");
    apiUrl.searchParams.set("use_cache", "if-recent");
    apiUrl.searchParams.set("fallback_to_cache", "on-error");

    const res = await fetch(apiUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
      // No AbortSignal — let it run; outer pipeline cap is the safety net.
    });
    const ms = Date.now() - t0;
    if (!res.ok) {
      const body = await res.text();
      log(
        `[${label}] proxycurl http ${res.status}: ${body.slice(0, 240)}\n`,
      );
      trace?.linkedInTierAttempt({
        tier: 0,
        method: "proxycurl",
        ok: false,
        durationMs: ms,
        reason: `proxycurl-${res.status}`,
      });
      return null;
    }
    const data = (await res.json()) as ProxyCurlProfile;
    const facts = proxyCurlToFacts(data, url);
    trace?.linkedInTierAttempt({
      tier: 0,
      method: "proxycurl",
      ok: facts.length > 0,
      durationMs: ms,
      reason: facts.length > 0 ? undefined : "proxycurl-empty",
    });
    trace?.linkedInFactsEmitted({
      tier: 0,
      positions: data.experiences?.length ?? 0,
      educations: data.education?.length ?? 0,
      skills: data.skills?.length ?? 0,
    });
    log(
      `[${label}] proxycurl ok — ${data.experiences?.length ?? 0} positions, ${data.education?.length ?? 0} educations, ${data.skills?.length ?? 0} skills\n`,
    );
    return facts;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`[${label}] proxycurl error: ${msg.slice(0, 240)}\n`);
    trace?.linkedInTierAttempt({
      tier: 0,
      method: "proxycurl",
      ok: false,
      durationMs: Date.now() - t0,
      reason: "proxycurl-exception",
    });
    return null;
  }
}

function fmtProxyCurlDate(
  d: ProxyCurlDate | null | undefined,
): string | undefined {
  if (!d?.year) return undefined;
  const y = String(d.year);
  if (!d.month) return y;
  const m = String(d.month).padStart(2, "0");
  if (!d.day) return `${y}-${m}`;
  return `${y}-${m}-${String(d.day).padStart(2, "0")}`;
}

/** Strip the `<br>` / `<br/>` HTML breaks EnrichLayer leaves in summary
 *  text so they render as paragraphs in our markdown rather than
 *  literal "<br>" strings. */
function htmlBreaksToNewlines(s: string | undefined): string | undefined {
  if (!s) return undefined;
  return s.replace(/<br\s*\/?>/gi, "\n").trim();
}

function proxyCurlToFacts(data: ProxyCurlProfile, url: string): TypedFact[] {
  const facts: TypedFact[] = [];
  const src = (snippet?: string) =>
    makeSource({
      fetcher: "linkedin-public",
      method: "scrape",
      confidence: "high",
      url,
      snippet,
    });

  // ── Identity / bio (PERSON + LIVES_IN) ────────────────────────────
  const location =
    [data.city, data.state, data.country_full_name ?? data.country]
      .filter((p): p is string => typeof p === "string" && p.length > 0)
      .join(", ") || undefined;
  const bio =
    htmlBreaksToNewlines(data.summary) ?? data.headline ?? data.occupation;
  const personPatch: Record<string, unknown> = {};
  if (data.full_name) personPatch.name = data.full_name;
  if (bio) personPatch.bio = bio;
  if (data.profile_pic_url) personPatch.avatarUrl = data.profile_pic_url;
  if (location) personPatch.location = location;
  if (Object.keys(personPatch).length > 0) {
    facts.push({
      kind: "PERSON",
      person: personPatch as Parameters<typeof Object>[0],
      source: src(bio?.slice(0, 300) ?? data.full_name),
    } as TypedFact);
  }
  if (location) {
    facts.push({
      kind: "LIVES_IN",
      location,
      source: src(location),
    });
  }

  // ── Work history (WORKED_AT) ──────────────────────────────────────
  for (const e of data.experiences ?? []) {
    if (!e.company) continue;
    const start = fmtProxyCurlDate(e.starts_at);
    const end = fmtProxyCurlDate(e.ends_at ?? null);
    facts.push({
      kind: "WORKED_AT",
      company: { canonicalName: e.company },
      attrs: {
        role: e.title ?? "",
        start,
        end,
        present: !e.ends_at,
        location: e.location ?? undefined,
        description: e.description ?? undefined,
      },
      source: src(e.description?.slice(0, 300) ?? `${e.title ?? ""} at ${e.company}`),
    });
  }

  // ── Education (STUDIED_AT) ────────────────────────────────────────
  for (const e of data.education ?? []) {
    if (!e.school) continue;
    facts.push({
      kind: "STUDIED_AT",
      school: { canonicalName: e.school },
      attrs: {
        degree: e.degree_name ?? "",
        start: fmtProxyCurlDate(e.starts_at),
        end: fmtProxyCurlDate(e.ends_at ?? null),
        field: e.field_of_study ?? undefined,
      },
      source: src(`${e.degree_name ?? ""} at ${e.school}`),
    });
  }

  // ── Skills (HAS_SKILL) ────────────────────────────────────────────
  for (const skill of (data.skills ?? []).slice(0, 30)) {
    if (!skill.trim()) continue;
    facts.push({
      kind: "HAS_SKILL",
      skill: { canonicalName: skill },
      attrs: {},
      source: src(skill),
    });
  }

  // ── Self-listed projects (BUILT) ──────────────────────────────────
  // These often have github.com URLs. The KG merger will dedupe by
  // homepageUrl + slug so a LinkedIn-listed project that already
  // exists as an owned repo gets folded in (with the user-written
  // description winning over the auto-generated one).
  for (const p of data.accomplishment_projects ?? []) {
    if (!p.title) continue;
    facts.push({
      kind: "BUILT",
      project: {
        title: p.title,
        purpose: p.description?.slice(0, 280) ?? p.title,
        kind: "product",
        polish: "shipped",
        homepageUrl: p.url || undefined,
        dates: {
          start: fmtProxyCurlDate(p.starts_at),
          end: fmtProxyCurlDate(p.ends_at ?? null),
          active: !p.ends_at,
        },
      },
      attrs: {
        start: fmtProxyCurlDate(p.starts_at),
        end: fmtProxyCurlDate(p.ends_at ?? null),
        active: !p.ends_at,
      },
      source: src(p.description?.slice(0, 300) ?? p.title),
    });
  }

  // ── Honors / awards (WON kind=award) ──────────────────────────────
  for (const h of data.accomplishment_honors_awards ?? []) {
    if (!h.title) continue;
    facts.push({
      kind: "WON",
      achievement: {
        title: h.title,
        kind: "award",
        date: fmtProxyCurlDate(h.issued_on),
        description: h.description?.slice(0, 400) ?? undefined,
      },
      attrs: {},
      source: src(h.description?.slice(0, 300) ?? h.title),
    });
  }

  // ── Certifications (WON kind=certification) ───────────────────────
  for (const c of data.certifications ?? []) {
    if (!c.name) continue;
    facts.push({
      kind: "WON",
      achievement: {
        title: c.name,
        kind: "certification",
        date: fmtProxyCurlDate(c.starts_at),
        description: [c.authority, c.license_number].filter(Boolean).join(" · "),
        url: c.url,
      },
      attrs: {},
      source: src(`${c.name}${c.authority ? ` — ${c.authority}` : ""}`),
    });
  }

  // ── Publications (AUTHORED) ───────────────────────────────────────
  for (const p of data.accomplishment_publications ?? []) {
    if (!p.name || !p.url) continue;
    facts.push({
      kind: "AUTHORED",
      publication: {
        title: p.name,
        url: p.url,
        kind: "blog",
        publishedAt: fmtProxyCurlDate(p.published_on),
        venue: p.publisher,
        summary: p.description?.slice(0, 600) ?? undefined,
      },
      attrs: { role: "author" },
      source: src(p.description?.slice(0, 300) ?? p.name),
    });
  }

  // ── Volunteer work (WORKED_AT, employmentType=volunteer) ──────────
  for (const v of data.volunteer_work ?? []) {
    if (!v.company || !v.title) continue;
    facts.push({
      kind: "WORKED_AT",
      company: { canonicalName: v.company },
      attrs: {
        role: v.title,
        start: fmtProxyCurlDate(v.starts_at),
        end: fmtProxyCurlDate(v.ends_at ?? null),
        present: !v.ends_at,
        description: v.description ?? undefined,
        employmentType: "volunteer",
      },
      source: src(v.description?.slice(0, 300) ?? `${v.title} (volunteer)`),
    });
  }

  return facts;
}

// ─── Tier 1: TinyFish ────────────────────────────────────────────────

async function tryTier1(args: {
  url: string;
  trace?: ScanTrace;
  log: (s: string) => void;
}): Promise<string | null> {
  const { url, trace, log } = args;
  // We used to skip TinyFish on /in/ URLs based on an early-run
  // observation that it always returned the wall. That was stale —
  // TinyFish is a proxy-rotating headless service designed for
  // exactly this case, and skipping it left the only working
  // public-side option on the table. We let it run on every
  // LinkedIn URL now and gate the result on the actual content
  // (`looksLikeLinkedinWall()` below).

  const tf = TinyFishClient.fromEnv();
  if (!tf) {
    trace?.linkedInTierAttempt({
      tier: 1,
      method: "tinyfish",
      ok: false,
      durationMs: 0,
      reason: "no-api-key",
    });
    return null;
  }

  const t0 = Date.now();
  const resp = await tf.fetchUrls([url], { format: "markdown" });
  const ms = Date.now() - t0;
  trace?.tinyfishFetch({
    urls: [url],
    ok: resp.ok,
    durationMs: ms,
    perUrl: resp.results.map((r) => ({
      url: r.url,
      finalUrl: r.finalUrl,
      title: r.title,
      textChars: r.text.length,
      language: r.language,
    })),
    requestError: resp.requestError,
  });
  if (!resp.ok) {
    trace?.linkedInTierAttempt({
      tier: 1,
      method: "tinyfish",
      ok: false,
      durationMs: ms,
      reason: resp.requestError ?? "request-failed",
    });
    return null;
  }
  const first = resp.results[0];
  if (first && isUsable(first.text, first.title)) {
    trace?.linkedInTierAttempt({
      tier: 1,
      method: "tinyfish",
      ok: true,
      durationMs: ms,
    });
    return first.text;
  }
  trace?.linkedInTierAttempt({
    tier: 1,
    method: "tinyfish",
    ok: false,
    durationMs: ms,
    reason: "walled-or-thin",
  });
  return null;
}

// ─── Tier 2: Jina Reader ─────────────────────────────────────────────

async function tryTier2(args: {
  url: string;
  trace?: ScanTrace;
  log: (s: string) => void;
}): Promise<string | null> {
  const { url, trace } = args;
  const t0 = Date.now();
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      redirect: "follow",
      headers: {
        Accept: "text/plain",
        "User-Agent": USER_AGENT,
      },
      signal: AbortSignal.timeout(JINA_TIMEOUT_MS),
    });
    const ms = Date.now() - t0;
    if (!res.ok) {
      trace?.linkedInTierAttempt({
        tier: 2,
        method: "jina",
        ok: false,
        durationMs: ms,
        reason: `http ${res.status}`,
      });
      return null;
    }
    const text = await res.text();
    if (!isUsable(text)) {
      trace?.linkedInTierAttempt({
        tier: 2,
        method: "jina",
        ok: false,
        durationMs: ms,
        reason: "walled-or-thin",
      });
      return null;
    }
    trace?.linkedInTierAttempt({
      tier: 2,
      method: "jina",
      ok: true,
      durationMs: ms,
    });
    return text;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    trace?.linkedInTierAttempt({
      tier: 2,
      method: "jina",
      ok: false,
      durationMs: Date.now() - t0,
      reason: `threw: ${msg}`,
    });
    return null;
  }
}

// ─── Wall detection (identical to linkedin.ts) ──────────────────────

export function isUsable(
  text: string | null | undefined,
  title?: string,
): boolean {
  if (!text) return false;
  if (title && LOGIN_WALL_TITLES.test(title.trim())) return false;
  if (text.length < MIN_TEXT_CHARS) {
    return !LOGIN_WALL_PATTERN.test(text);
  }
  return true;
}

// ─── LLM extraction ──────────────────────────────────────────────────

async function extract(args: {
  text: string;
  url: string;
  session: ScanSession;
  usage: SessionUsage;
  trace?: ScanTrace;
  log: (s: string) => void;
}): Promise<LinkedInExtraction> {
  const { text, url, session, usage, trace, log } = args;
  const { result } = await runAgentWithSubmit({
    model: modelForRole("bulk"),
    systemPrompt: SYSTEM_PROMPT,
    input: `## Source URL\n${url}\n\n## Scraped text\n\n${text.slice(0, 40_000)}\n\n---\nExtract positions, educations, skills, bio, location. Call submit_linkedin_extraction.`,
    submitToolName: "submit_linkedin_extraction",
    submitToolDescription:
      "Submit the extracted LinkedIn profile data. Call exactly once.",
    submitSchema: LinkedInExtractionSchema,
    reasoning: { effort: "low" },
    session,
    usage,
    label: "fetcher:linkedin-public",
    onProgress: log,
    trace,
  });
  return result;
}

// ─── Fact builder (shared across tier 1-3, same source template) ────

export function buildFacts(args: {
  extraction: LinkedInExtraction;
  url?: string;
  label: "linkedin-public" | "linkedin-pdf";
  confidence?: "high" | "medium" | "low";
}): TypedFact[] {
  const { extraction, url, label } = args;
  const confidence = args.confidence ?? "medium";
  const facts: TypedFact[] = [];

  const src = (snippet?: string) =>
    makeSource({
      fetcher: label,
      method: label === "linkedin-pdf" ? "llm-extraction" : "scrape",
      confidence,
      url,
      snippet,
      authority: undefined,
    });

  if (extraction.bio || extraction.location) {
    facts.push({
      kind: "PERSON",
      person: {
        bio: extraction.bio,
        location: extraction.location,
      },
      source: src(extraction.bio?.slice(0, 300)),
    });
  }

  if (extraction.location) {
    facts.push({
      kind: "LIVES_IN",
      location: extraction.location,
      source: src(extraction.location.slice(0, 200)),
    });
  }

  for (const p of extraction.positions) {
    facts.push({
      kind: "WORKED_AT",
      company: { canonicalName: p.company },
      attrs: {
        role: p.title,
        start: p.start,
        end: p.end,
        present: p.present,
        location: p.location,
        description: p.description,
      },
      source: src(p.description?.slice(0, 300) ?? `${p.title} at ${p.company}`),
    });
  }

  for (const e of extraction.educations) {
    facts.push({
      kind: "STUDIED_AT",
      school: { canonicalName: e.school },
      attrs: {
        degree: e.degree,
        start: e.start,
        end: e.end,
        field: e.field,
      },
      source: src(`${e.degree} at ${e.school}`),
    });
  }

  for (const skill of extraction.skills) {
    facts.push({
      kind: "HAS_SKILL",
      skill: { canonicalName: skill },
      attrs: {},
      source: src(skill),
    });
  }

  return facts;
}

// ─── Trace helper — one FetcherFacts event per logical batch ────────

export function emitFactsToTrace(
  trace: ScanTrace | undefined,
  label: string,
  facts: TypedFact[],
): void {
  if (!trace) return;
  const byKind = new Map<string, TypedFact[]>();
  for (const f of facts) {
    const arr = byKind.get(f.kind) ?? [];
    arr.push(f);
    byKind.set(f.kind, arr);
  }
  for (const [kind, arr] of byKind) {
    trace.fetcherFacts({
      label,
      entityType: kind,
      count: arr.length,
      preview: JSON.stringify(arr.slice(0, 5)),
    });
  }
}
