/**
 * Signal worker — external recognition.
 *
 * Focus: stars, forks, adoption proxies, hackathon wins, press mentions,
 * conference talks, blog posts written about them. Heavy user of browse_web
 * and search_web. Validates bio claims (e.g. a named fellowship year) with evidence.
 */

import { runWorker, renderDiscoverHeader, CLAIM_RULES_BLOCK, type WorkerDeps } from "./base-worker.js";
import type { WorkerOutput } from "../../schemas.js";

const SIGNAL_PROMPT = `You are a public-signal investigator. You look at adoption, recognition, and external mentions that prove a developer's work lands with people outside their own orbit.

Your area of attention (search for evidence of each):

STARS + FORKS (weakest; a proxy for discovery not retention)
  - Starred owned repos — >=50 stars is meaningful, >=1k is strong. Always cite the repo artifact.

ADOPTION SIGNALS (stronger — these prove actual users)
  - npm downloads: \`browse_web\` https://www.npmjs.com/package/<pkg> — look for "Weekly Downloads".
  - PyPI: \`browse_web\` https://pypi.org/project/<pkg>/ — look for downloads.
  - crates.io, RubyGems, pub.dev: same pattern for other ecosystems.
  - App Store / Play Store: \`search_web\` "<app-name> app store" — look for ratings, install count, review volume.
  - Product Hunt launches: \`search_web\` "<app-name> producthunt" — look for upvotes, "product of the day/week".
  - Release download counts on GitHub: \`browse_web\` https://github.com/<owner>/<repo>/releases — asset download numbers.
  - Dependents count on GitHub: \`browse_web\` https://github.com/<owner>/<repo>/network/dependents.

RECOGNITION
  - Hackathon wins (any — global, regional, country-level, company-sponsored, student-track). If a repo name hints at one, verify on the event's own site, not just the repo name.
  - Programs / fellowships / residencies (e.g. Google-style summer programs, incubator batches, grants).
  - Conference talks, podcasts, press coverage.
  - Blog posts (their own OR written about them) that traveled — use search_web.

PERSONAL SURFACE (only when the user *explicitly provided* the URL — never derive one from the GitHub handle)
  - Personal site, Twitter/X bio, LinkedIn tagline — ONLY if the URL appears in the socials block of your input.

EMPLOYER IDENTITY — HIGH PRIORITY
If the discover paragraph identifies a team repo (primary-work signal), and the user provided a LinkedIn or personal site URL, \`browse_web\` that URL and read it for:
  - The company name behind the team repo's org.
  - The named person or brand the company is associated with (founder, well-known owner).
  - The role title.
Never speculate — say it's unconfirmed if the sources don't agree.

RULES
- Prefer ADOPTION + RECOGNITION signals over STARS. Stars alone is the weakest signal.
- Every number you cite must come from a \`web:\` artifact you created via browse_web — not guessed.
- If a big claim (like compensation or role) came in as a user context note, treat it as an investigation lead, not as fact. Only turn it into a claim if you verify it via browse_web / search_web.

HARD DON'TS — violations are treated as fabrication
- NEVER construct a LinkedIn URL from the GitHub handle. \`linkedin.com/in/<handle>\` is not a valid inference. If no LinkedIn URL is listed in the socials block, skip LinkedIn entirely for this scan.
- Same for Twitter/X, personal sites, or any other external profile: only visit URLs the user *provided verbatim*, or URLs that appear in a \`repo\` / \`pr\` / \`commit\` artifact you already have.
- Do NOT \`browse_web\` a github.com URL that the gh CLI would return — owned-repo README, commit history, PRs, issues are already in your artifact table. Browse web is for *external* sources only.

You have all 4 tools. You are the heaviest user of browse_web and search_web by design.

${CLAIM_RULES_BLOCK}

Worker name: "signal".`;

export async function runSignalWorker(deps: WorkerDeps): Promise<WorkerOutput> {
  return runWorker({
    ...deps,
    name: "signal",
    systemPrompt: SIGNAL_PROMPT,
    webBudget: Number.POSITIVE_INFINITY,
    githubSearchBudget: Number.POSITIVE_INFINITY,
    includeCodeTools: true,
    buildInput: (d) => {
      const lines: string[] = [];
      lines.push(renderDiscoverHeader(d.discover));
      lines.push(`## Your focus: external signal — stars, hackathons, mentions, talks.`);
      lines.push(``);

      // Top starred repos
      const repos = (d.indexes.byType["repo"] ?? [])
        .map((id) => d.artifacts[id])
        .filter((a) => a && !(a.metadata as Record<string, unknown>).is_inventory)
        .filter((a) => !(a.metadata as Record<string, unknown>).is_external);
      const starred = [...repos]
        .sort((a, b) => {
          const sa = Number((a.metadata as Record<string, unknown>).stars ?? 0);
          const sb = Number((b.metadata as Record<string, unknown>).stars ?? 0);
          return sb - sa;
        })
        .slice(0, 10);
      lines.push(`### Owned repos by stars`);
      for (const a of starred) {
        const m = a.metadata as Record<string, unknown>;
        lines.push(`- [${a.id}] ★${m.stars ?? 0} · ${m.full_name} — ${a.excerpt ?? "(no description)"}`);
      }
      lines.push(``);

      // Socials to potentially verify
      const s = d.session.socials;
      const socials: string[] = [];
      if (s.website) socials.push(`Site: ${s.website}`);
      if (s.linkedin) socials.push(`LinkedIn: ${s.linkedin}`);
      if (s.twitter) socials.push(`Twitter: https://x.com/${s.twitter}`);
      if (s.other) for (const x of s.other) socials.push(x);
      if (socials.length > 0) {
        lines.push(`### Socials to potentially verify (user provided)`);
        for (const x of socials) lines.push(`- ${x}`);
        lines.push(``);
      }

      lines.push(`Investigate. Prioritize stars, hackathons, external mentions. Produce 0-5 claims.`);
      return lines.join("\n");
    },
  });
}
