/**
 * orcid fetcher — first-party public API.
 *
 * ORCID iDs are unique researcher identifiers. The public API
 * (`pub.orcid.org`) returns canonical employment, education, and
 * publication data without auth. This is the highest-authority source
 * we have for researchers — marked with `authority: "first-party-api"`
 * so the confidence-band derivation lifts it to "verified".
 */

import { makeSource } from "@gitshow/shared/kg";
import type { TypedFact, PublicationKind } from "@gitshow/shared/kg";
import type { ScanSession } from "../../schemas.js";
import type { SessionUsage } from "../../session.js";
import type { ScanTrace } from "../observability/trace.js";
import { emitFactsToTrace } from "./linkedin-public.js";

export interface FetcherInput {
  session: ScanSession;
  usage: SessionUsage;
  trace?: ScanTrace;
  onProgress?: (text: string) => void;
}

const ORCID_ID_PATTERN = /\d{4}-\d{4}-\d{4}-\d{3}[\dX]/;
const API_TIMEOUT_MS = 30_000;

// ─── ORCID response shape (very partial) ─────────────────────────────

interface OrcidRecord {
  person?: {
    name?: {
      "given-names"?: { value?: string };
      "family-name"?: { value?: string };
      "credit-name"?: { value?: string };
    };
    addresses?: {
      address?: Array<{ country?: { value?: string }; "region"?: { value?: string } }>;
    };
    "researcher-urls"?: {
      "researcher-url"?: Array<{
        "url-name"?: { value?: string } | null;
        url?: { value?: string };
      }>;
    };
  };
  "activities-summary"?: {
    employments?: {
      "affiliation-group"?: Array<{
        summaries?: Array<{
          "employment-summary"?: OrcidAffiliationSummary;
        }>;
      }>;
    };
    educations?: {
      "affiliation-group"?: Array<{
        summaries?: Array<{
          "education-summary"?: OrcidAffiliationSummary;
        }>;
      }>;
    };
    works?: {
      group?: Array<{
        "work-summary"?: Array<OrcidWorkSummary>;
      }>;
    };
  };
}

interface OrcidAffiliationSummary {
  "role-title"?: string | null;
  "department-name"?: string | null;
  organization?: {
    name?: string;
    address?: { city?: string; region?: string; country?: string };
  };
  "start-date"?: OrcidDate;
  "end-date"?: OrcidDate;
}

interface OrcidDate {
  year?: { value?: string };
  month?: { value?: string };
  day?: { value?: string };
}

interface OrcidWorkSummary {
  title?: {
    title?: { value?: string };
  };
  type?: string;
  "publication-date"?: OrcidDate;
  "external-ids"?: {
    "external-id"?: Array<{
      "external-id-type"?: string;
      "external-id-value"?: string;
      "external-id-url"?: { value?: string };
    }>;
  };
  url?: { value?: string };
  "journal-title"?: { value?: string };
}

export async function runOrcidFetcher(
  input: FetcherInput,
): Promise<TypedFact[]> {
  const label = "orcid";
  const t0 = Date.now();
  const raw = input.session.socials.orcid;
  const log = input.onProgress ?? (() => {});
  const trace = input.trace;

  trace?.fetcherStart({ label, input: { raw, hasUrl: !!raw } });

  if (!raw) {
    trace?.fetcherEnd({
      label,
      durationMs: Date.now() - t0,
      factsEmitted: 0,
      status: "empty",
    });
    return [];
  }
  const match = raw.match(ORCID_ID_PATTERN);
  if (!match) {
    log(`[${label}] no ORCID iD found in "${raw}"\n`);
    trace?.fetcherEnd({
      label,
      durationMs: Date.now() - t0,
      factsEmitted: 0,
      status: "empty",
    });
    return [];
  }
  const id = match[0];
  const apiUrl = `https://pub.orcid.org/v3.0/${id}/record`;

  try {
    const res = await fetch(apiUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (!res.ok) {
      log(`[${label}] http ${res.status}\n`);
      trace?.fetcherEnd({
        label,
        durationMs: Date.now() - t0,
        factsEmitted: 0,
        status: "empty",
      });
      return [];
    }
    const data = (await res.json()) as OrcidRecord;

    // ── Self-link verification ──────────────────────────────────────
    // The user typed the ORCID iD at intake — anyone can paste any
    // iD, so the API call itself proves nothing about ownership. We
    // require the ORCID profile's `researcher-urls` to link back to
    // the user's GitHub (or commit a verified GitHub link in the
    // bio, etc.). Without that cross-link we still extract the
    // affiliations + name (those are useful priors), but we DROP
    // the publication facts — surfacing someone else's papers on
    // the user's portfolio is the worst-case failure mode and we
    // saw it in the wild (Yatendra Kumar getting Yatendra Singh's
    // pharmacology papers).
    const verified = orcidLinksToGithub(data, input.session.handle);
    if (!verified) {
      log(
        `[${label}] ORCID profile does NOT cross-link to github.com/${input.session.handle} — keeping affiliations, dropping publications.\n`,
      );
    }
    const facts = buildFacts({ data, orcidUrl: raw, id, verified });
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

function fmtDate(d?: OrcidDate): string | undefined {
  if (!d) return undefined;
  const y = d.year?.value;
  if (!y) return undefined;
  const m = d.month?.value;
  const day = d.day?.value;
  if (m && day) return `${y}-${m.padStart(2, "0")}-${day.padStart(2, "0")}`;
  if (m) return `${y}-${m.padStart(2, "0")}`;
  return y;
}

function mapWorkKind(type: string | undefined): PublicationKind {
  const t = (type ?? "").toLowerCase();
  if (t.includes("preprint")) return "preprint";
  if (t.includes("journal") || t.includes("conference-paper") || t.includes("book-chapter")) {
    return "paper";
  }
  if (t.includes("lecture") || t.includes("conference-abstract")) return "talk";
  if (t.includes("podcast")) return "podcast";
  return "other";
}

/**
 * Does the ORCID profile cross-link back to the user's GitHub? We
 * accept either:
 *   - any researcher-url whose href contains `github.com/{handle}` or
 *     `github.com/{handle}/`
 *   - a researcher-url named GitHub whose href matches
 *
 * Used as a proof-of-ownership gate before publication facts get
 * attached to the user's portfolio.
 */
function orcidLinksToGithub(data: OrcidRecord, handle: string): boolean {
  const urls = data.person?.["researcher-urls"]?.["researcher-url"] ?? [];
  const lcHandle = handle.toLowerCase();
  for (const u of urls) {
    const href = (u.url?.value ?? "").toLowerCase();
    if (!href) continue;
    if (
      href.includes(`github.com/${lcHandle}`) ||
      href.endsWith(`/${lcHandle}`) ||
      href.endsWith(`/${lcHandle}/`)
    ) {
      return true;
    }
  }
  return false;
}

function buildFacts(args: {
  data: OrcidRecord;
  orcidUrl: string;
  id: string;
  /** Did the ORCID profile cross-link to the user's GitHub? */
  verified: boolean;
}): TypedFact[] {
  const { data, orcidUrl, id, verified } = args;
  const facts: TypedFact[] = [];
  // first-party-api authority is preserved; confidence is the lever
  // we use for self-link verification. high (verified link) →
  // verified band, medium (unverified self-claimed) → likely band.
  const src = (snippet?: string) =>
    makeSource({
      fetcher: "orcid",
      method: "api",
      confidence: verified ? "high" : "medium",
      url: orcidUrl,
      snippet,
      authority: "first-party-api",
    });

  // PERSON
  const given = data.person?.name?.["given-names"]?.value;
  const family = data.person?.name?.["family-name"]?.value;
  const full = data.person?.name?.["credit-name"]?.value
    ?? [given, family].filter(Boolean).join(" ");
  const address = data.person?.addresses?.address?.[0];
  const locationParts = [
    address?.region?.value,
    address?.country?.value,
  ].filter((p): p is string => typeof p === "string");
  const location = locationParts.length > 0 ? locationParts.join(", ") : undefined;

  if (full || location) {
    facts.push({
      kind: "PERSON",
      person: {
        name: full || undefined,
        location,
        url: orcidUrl,
      },
      source: src(full),
    });
  }
  if (location) {
    facts.push({
      kind: "LIVES_IN",
      location,
      source: src(location),
    });
  }

  // Employments → WORKED_AT
  const employments = data["activities-summary"]?.employments?.["affiliation-group"] ?? [];
  for (const group of employments) {
    for (const s of group.summaries ?? []) {
      const emp = s["employment-summary"];
      if (!emp?.organization?.name) continue;
      const addr = emp.organization.address;
      const locStr = [addr?.city, addr?.region, addr?.country]
        .filter((p): p is string => typeof p === "string")
        .join(", ");
      facts.push({
        kind: "WORKED_AT",
        company: { canonicalName: emp.organization.name },
        attrs: {
          role: emp["role-title"] ?? emp["department-name"] ?? "",
          start: fmtDate(emp["start-date"]),
          end: fmtDate(emp["end-date"]),
          present: !emp["end-date"],
          location: locStr || undefined,
        },
        source: src(`${emp["role-title"] ?? ""} at ${emp.organization.name}`),
      });
    }
  }

  // Educations → STUDIED_AT
  const educations = data["activities-summary"]?.educations?.["affiliation-group"] ?? [];
  for (const group of educations) {
    for (const s of group.summaries ?? []) {
      const edu = s["education-summary"];
      if (!edu?.organization?.name) continue;
      facts.push({
        kind: "STUDIED_AT",
        school: { canonicalName: edu.organization.name },
        attrs: {
          degree: edu["role-title"] ?? edu["department-name"] ?? "",
          field: edu["department-name"] ?? undefined,
          start: fmtDate(edu["start-date"]),
          end: fmtDate(edu["end-date"]),
        },
        source: src(`${edu["role-title"] ?? ""} at ${edu.organization.name}`),
      });
    }
  }

  // Works → AUTHORED. Only emit publication facts when the ORCID
  // profile cross-links to the user's GitHub. Without that proof of
  // ownership, the user could paste any ORCID iD and get a stranger's
  // entire bibliography on their portfolio. Affiliations stay (above)
  // because they're useful even at lower confidence.
  if (verified) {
    const workGroups = data["activities-summary"]?.works?.group ?? [];
    for (const group of workGroups) {
      for (const w of group["work-summary"] ?? []) {
        const title = w.title?.title?.value;
        if (!title) continue;
        const externalIds = w["external-ids"]?.["external-id"] ?? [];
        const doi = externalIds.find(
          (e) => (e["external-id-type"] ?? "").toLowerCase() === "doi",
        )?.["external-id-value"];
        const arxivId = externalIds.find(
          (e) => (e["external-id-type"] ?? "").toLowerCase() === "arxiv",
        )?.["external-id-value"];
        const url = w.url?.value
          ?? externalIds.find((e) => e["external-id-url"]?.value)?.["external-id-url"]?.value
          ?? (doi ? `https://doi.org/${doi}` : `https://orcid.org/${id}`);
        facts.push({
          kind: "AUTHORED",
          publication: {
            title,
            url,
            kind: mapWorkKind(w.type),
            doi,
            arxivId,
            venue: w["journal-title"]?.value,
            publishedAt: fmtDate(w["publication-date"]),
            coAuthors: [],
          },
          source: src(title),
        });
      }
    }
  }

  return facts;
}
