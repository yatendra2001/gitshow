/**
 * contact-agent — NO LLM. Pure rule-based normalization.
 *
 * Consolidates sources of social links into the Resume's contact block:
 *   - Scan session socials (user-provided at CLI / via webapp intake)
 *   - GitHub profile fields (twitter_username, blog URL)
 *   - Linktree-style blocks parsed out of the profile README (future)
 *
 * Each link gets a canonical iconKey matched against the template's icon
 * registry. Unknown iconKeys fall back to 'generic' and render as a globe
 * — the UI never breaks because of a missing mapping.
 */

import type { ScanSession } from "../../schemas.js";
import type { GitHubData } from "../../types.js";

export interface SocialLink {
  name: string;
  url: string;
  iconKey: string;
  navbar: boolean;
}

export interface ContactOutput {
  email?: string;
  socials: {
    github?: SocialLink;
    linkedin?: SocialLink;
    x?: SocialLink;
    youtube?: SocialLink;
    website?: SocialLink;
    email?: SocialLink;
    other: SocialLink[];
  };
}

export interface ContactAgentInput {
  session: ScanSession;
  github: GitHubData;
}

export function runContactAgent(input: ContactAgentInput): ContactOutput {
  const { session, github } = input;
  const s = session.socials;

  const github_: SocialLink = {
    name: "GitHub",
    url: `https://github.com/${session.handle}`,
    iconKey: "github",
    navbar: true,
  };

  let linkedin: SocialLink | undefined;
  if (s.linkedin) {
    linkedin = {
      name: "LinkedIn",
      url: normalizeLinkedin(s.linkedin),
      iconKey: "linkedin",
      navbar: true,
    };
  }

  let x: SocialLink | undefined;
  // Prefer user-provided twitter handle. GitHub profile doesn't include
  // twitter in the current GitHubProfile shape — when the fetcher is
  // enriched to pull it, add a `github.profile.twitterUsername` fallback.
  if (s.twitter) {
    x = {
      name: "X",
      url: `https://x.com/${stripAtAndSlash(s.twitter)}`,
      iconKey: "x",
      navbar: true,
    };
  }

  let website: SocialLink | undefined;
  if (s.website) {
    website = {
      name: "Website",
      url: ensureHttps(s.website),
      iconKey: "globe",
      navbar: true,
    };
  }

  // GitHubProfile today doesn't expose email — email comes later from
  // commit-author records in normalize. Leaving undefined for now.
  const email: string | undefined = undefined;
  const emailSocial: SocialLink | undefined = undefined;

  const other: SocialLink[] = [];
  for (const raw of s.other ?? []) {
    const parsed = parseOtherSocial(raw);
    if (parsed) other.push(parsed);
  }

  return {
    email,
    socials: {
      github: github_,
      linkedin,
      x,
      website,
      email: emailSocial,
      other,
    },
  };
}

function normalizeLinkedin(input: string): string {
  const trimmed = input.trim().replace(/^@/, "");
  if (/^https?:\/\//.test(trimmed)) return trimmed;
  // Accept either "in/handle" or bare "handle".
  const handle = trimmed.replace(/^(in|www\.linkedin\.com\/in)\//, "");
  return `https://www.linkedin.com/in/${handle}`;
}

function stripAtAndSlash(input: string): string {
  return input.trim().replace(/^@/, "").replace(/^\/+/, "").split("/")[0];
}

function ensureHttps(url: string): string {
  if (/^https?:\/\//.test(url)) return url;
  return `https://${url}`;
}

/**
 * Best-effort classifier for user-supplied "other" social URLs.
 * Maps obvious platforms to known iconKeys; falls back to a generic globe.
 */
function parseOtherSocial(raw: string): SocialLink | null {
  const url = raw.trim();
  if (!url) return null;
  const lower = url.toLowerCase();
  let iconKey = "generic";
  let name = "Link";
  if (lower.includes("youtube.com") || lower.includes("youtu.be")) {
    iconKey = "youtube";
    name = "YouTube";
  } else if (lower.includes("medium.com")) {
    iconKey = "medium";
    name = "Medium";
  } else if (lower.includes("dev.to")) {
    iconKey = "devto";
    name = "dev.to";
  } else if (lower.includes("hashnode.com") || lower.includes("hashnode.dev")) {
    iconKey = "hashnode";
    name = "Hashnode";
  } else if (lower.includes("substack.com")) {
    iconKey = "substack";
    name = "Substack";
  } else if (lower.includes("bsky.app") || lower.includes("bluesky")) {
    iconKey = "bluesky";
    name = "Bluesky";
  } else if (lower.includes("mastodon")) {
    iconKey = "mastodon";
    name = "Mastodon";
  } else if (lower.includes("producthunt.com")) {
    iconKey = "producthunt";
    name = "Product Hunt";
  }
  return {
    name,
    url: ensureHttps(url),
    iconKey,
    navbar: true,
  };
}
