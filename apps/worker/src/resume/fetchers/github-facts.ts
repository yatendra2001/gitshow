/**
 * github-facts — projects the already-fetched GitHubData into TypedFacts.
 *
 * This is NOT a network fetcher — it runs synchronously over the data
 * `github-fetcher.ts` already produced. It exists so the merger sees a
 * consistent TypedFact stream whether facts came from GitHub, ORCID, or
 * a Jina scrape.
 *
 * Emits:
 *   - PERSON (name, bio, location, avatar, url) from `github.profile`.
 *   - LIVES_IN when `profile.location` is set.
 *   - CONTRIBUTED_TO for each owned repo (high confidence, owner).
 *   - CONTRIBUTED_TO for each external drive-by repo (medium confidence,
 *     contributor).
 *   - WORKED_AT (low confidence, domain hint) when a user's commit email
 *     domain looks corporate — i.e. NOT gmail/proton/outlook/etc.
 */

import { makeSource } from "@gitshow/shared/kg";
import type { TypedFact } from "@gitshow/shared/kg";
import type {
  GitHubData,
  RepoRef,
  RepoRelationship,
} from "../../types.js";
import type { ScanTrace } from "../observability/trace.js";

// Common personal-email domains — never infer employment from these.
const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "proton.me",
  "protonmail.com",
  "tutanota.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "fastmail.com",
  "hey.com",
  "duck.com",
  "zoho.com",
  "mail.com",
  "pm.me",
  "users.noreply.github.com",
]);

export interface EmitGithubFactsInput {
  github: GitHubData;
  trace?: ScanTrace;
}

export function emitGithubFacts(input: EmitGithubFactsInput): TypedFact[] {
  const { github } = input;
  const profile = github.profile;
  const githubUrl = `https://github.com/${profile.login}`;
  const facts: TypedFact[] = [];

  const profileSrc = () =>
    makeSource({
      fetcher: "github-fetcher",
      method: "api",
      confidence: "high",
      url: githubUrl,
      snippet: profile.bio ?? undefined,
    });

  // PERSON
  facts.push({
    kind: "PERSON",
    person: {
      name: profile.name ?? undefined,
      bio: profile.bio ?? undefined,
      location: profile.location ?? undefined,
      avatarUrl: profile.avatarUrl ?? undefined,
      url: githubUrl,
    },
    source: profileSrc(),
  });

  // LIVES_IN
  if (profile.location) {
    facts.push({
      kind: "LIVES_IN",
      location: profile.location,
      source: profileSrc(),
    });
  }

  // CONTRIBUTED_TO — owned / collab / org_member
  for (const repo of github.ownedRepos) {
    facts.push(buildContributedTo(repo, { kind: "owned" }));
  }

  // External drive-by repos (authored PRs to non-owned repos).
  // The GitHub fetcher already merged everything into ownedRepos with a
  // `relationship` field. Re-project repos whose relationship is
  // "contributor" as external, so we can emit them with lower confidence
  // if they aren't already.
  // (In practice the `ownedRepos` for-loop above already emitted them;
  // this is a no-op today. Kept here to make the intent explicit — future
  // code paths may populate a separate `externalRepos` field, and we're
  // ready for it.)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const externalRepos = (github as unknown as { externalRepos?: RepoRef[] })
    .externalRepos;
  if (Array.isArray(externalRepos)) {
    for (const repo of externalRepos) {
      facts.push(buildContributedTo(repo, { kind: "external" }));
    }
  }

  // Commit-email-domain hint → WORKED_AT(confidence: low)
  for (const email of github.userEmails) {
    const domain = email.split("@")[1]?.toLowerCase();
    if (!domain || PERSONAL_EMAIL_DOMAINS.has(domain)) continue;
    const companyName = guessCompanyFromDomain(domain);
    facts.push({
      kind: "WORKED_AT",
      company: {
        canonicalName: companyName,
        domain,
      },
      attrs: {
        role: "(commit email domain hint)",
      },
      source: makeSource({
        fetcher: "github-hint",
        method: "api",
        confidence: "low",
        url: githubUrl,
        snippet: `commit email domain: ${domain}`,
      }),
    });
  }

  return facts;
}

function buildContributedTo(
  repo: RepoRef,
  opts: { kind: "owned" | "external" },
): TypedFact {
  const relationship = resolveRelationship(repo.relationship, opts.kind);
  const confidence: "high" | "medium" | "low" =
    opts.kind === "owned" && (relationship === "owner" || relationship === "collaborator" || relationship === "org_member")
      ? "high"
      : "medium";
  const fullName = repo.fullName;
  const homepageUrl = `https://github.com/${fullName}`;

  return {
    kind: "CONTRIBUTED_TO",
    repository: {
      fullName,
      primaryLanguage: repo.primaryLanguage ?? undefined,
      isPrivate: repo.isPrivate,
      isFork: repo.isFork,
      isArchived: repo.isArchived,
      stars: repo.stargazerCount,
      pushedAt: repo.pushedAt ?? undefined,
      description: repo.description ?? undefined,
      homepageUrl: undefined,
      userCommitCount: repo.userCommitCount,
    },
    attrs: {
      relationship: mapRelationship(relationship),
      commits: repo.userCommitCount,
      mergedPRs: repo.contributionSignals?.prsMerged,
    },
    source: makeSource({
      fetcher: "github-fetcher",
      method: "api",
      confidence,
      url: homepageUrl,
      snippet: repo.description ?? `${fullName} (${repo.primaryLanguage ?? "?"})`,
    }),
  };
}

function resolveRelationship(
  rel: RepoRelationship | undefined,
  fallback: "owned" | "external",
): RepoRelationship {
  if (rel) return rel;
  return fallback === "owned" ? "owner" : "contributor";
}

function mapRelationship(
  rel: RepoRelationship,
): "owner" | "collaborator" | "contributor" | "reviewer" {
  // TypedFact.attrs.relationship is a narrower union than the internal
  // RepoRelationship. Collapse org_member → collaborator; keep the rest.
  if (rel === "org_member") return "collaborator";
  return rel;
}

function guessCompanyFromDomain(domain: string): string {
  // Strip common TLDs to get a humanish canonical name. "acme.io" →
  // "acme"; "acme-labs.com" → "acme-labs". The merger normalises further.
  const stripped = domain.replace(/\.(com|io|ai|co|dev|net|org|xyz|app|cloud)$/i, "");
  return stripped || domain;
}
