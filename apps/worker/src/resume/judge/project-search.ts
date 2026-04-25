/**
 * Project search — runs after the Sonnet ranker has picked the top
 * 6 projects for the grid. For each pick we fire one Tavily search
 * and surface up to 3 high-signal mentions (HN / Product Hunt /
 * dev.to / reddit / press articles) onto the project card.
 *
 * Stage is gated on `TAVILY_API_KEY`. Without the env var the
 * pipeline runs as before — graceful degradation, no hard fail.
 *
 * Cost: ~$0.005 per Tavily query × 6 picks ≈ $0.03 / scan. Trivial.
 */
import type { ScanTrace } from "../observability/trace.js";
import type { WebMention } from "@gitshow/shared/kg";
import type { ProjectRankerOutput } from "./project-ranker.js";

export interface ProjectSearchInput {
  ranking: ProjectRankerOutput;
  /** Display title per repo full name (for query construction). */
  titleByRepo: Record<string, string>;
  /** Homepage URL per repo full name (when known) — boosts query precision. */
  homepageByRepo: Record<string, string | undefined>;
  /** GitHub handle — used as a disambiguator in the query. */
  handle: string;
  trace?: ScanTrace;
  log: (s: string) => void;
}

export interface ProjectSearchOutput {
  /** repoFullName → up to 3 web mentions, ranked by Tavily score. */
  mentionsByRepo: Record<string, WebMention[]>;
}

const TAVILY_ENDPOINT = "https://api.tavily.com/search";
const PER_PROJECT_BUDGET_MS = 12_000;
const MAX_MENTIONS_PER_PROJECT = 3;

const ALLOWED_HOSTS_RE =
  /(news\.ycombinator\.com|producthunt\.com|dev\.to|reddit\.com|hashnode\.dev|substack\.com|medium\.com|techcrunch\.com|theverge\.com|wired\.com|arstechnica\.com|hackernoon\.com)/i;

interface TavilyResult {
  url: string;
  title: string;
  content?: string;
  score?: number;
}

/**
 * Runs the search for every ranker pick. Returns mentions keyed by
 * repo full name. Failures per-project are swallowed — one bad query
 * shouldn't take the whole stage down.
 */
export async function runProjectSearch(
  input: ProjectSearchInput,
): Promise<ProjectSearchOutput> {
  const { ranking, titleByRepo, homepageByRepo, handle, trace, log } = input;
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    log(`[project-search] no TAVILY_API_KEY — skipping web mentions stage\n`);
    trace?.note(
      "project-search:skipped",
      "no TAVILY_API_KEY in env — web mentions disabled for this scan",
    );
    return { mentionsByRepo: {} };
  }
  if (ranking.picks.length === 0) {
    return { mentionsByRepo: {} };
  }

  const out: Record<string, WebMention[]> = {};

  // Run picks in parallel — Tavily handles concurrent requests fine
  // and we only have ≤6 to issue per scan.
  await Promise.all(
    ranking.picks.map(async (pick) => {
      const title = titleByRepo[pick.repoFullName] ?? pick.repoFullName;
      const homepage = homepageByRepo[pick.repoFullName];
      try {
        const mentions = await searchOne({
          apiKey,
          repoFullName: pick.repoFullName,
          title,
          homepage,
          handle,
          log,
        });
        if (mentions.length > 0) {
          out[pick.repoFullName] = mentions;
        }
      } catch (err) {
        log(
          `[project-search] ${pick.repoFullName} failed: ${(err as Error).message.slice(0, 120)}\n`,
        );
      }
    }),
  );

  trace?.note(
    "project-search:summary",
    `${Object.keys(out).length} of ${ranking.picks.length} picks have web mentions`,
    {
      picks: ranking.picks.length,
      withMentions: Object.keys(out).length,
    },
  );
  return { mentionsByRepo: out };
}

async function searchOne(args: {
  apiKey: string;
  repoFullName: string;
  title: string;
  homepage?: string;
  handle: string;
  log: (s: string) => void;
}): Promise<WebMention[]> {
  const { apiKey, repoFullName, title, homepage, handle, log } = args;

  // Construct a precise query: title + handle + a hint at what we're
  // looking for. Including the handle drops false matches on common
  // names ("Tevo" alone returns the wrong things; "Tevo yatendra2001"
  // is anchored).
  const queryParts = [title, handle];
  if (homepage) queryParts.push(homepage);
  const query = queryParts.join(" ");

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PER_PROJECT_BUDGET_MS);

  let body: { results?: TavilyResult[] };
  try {
    const res = await fetch(TAVILY_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "basic",
        max_results: 8,
        // Include domain whitelist so we avoid SEO blogspam.
        include_domains: [
          "news.ycombinator.com",
          "producthunt.com",
          "dev.to",
          "reddit.com",
          "hashnode.dev",
          "substack.com",
          "medium.com",
          "techcrunch.com",
          "theverge.com",
          "wired.com",
          "arstechnica.com",
          "hackernoon.com",
        ],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      log(
        `[project-search] ${repoFullName} tavily http ${res.status}: ${errBody.slice(0, 160)}\n`,
      );
      return [];
    }
    body = (await res.json()) as { results?: TavilyResult[] };
  } finally {
    clearTimeout(t);
  }

  const results = body.results ?? [];
  const filtered = results
    // Defence in depth: even with include_domains, Tavily occasionally
    // returns extras. Keep only the ones on our allow-list.
    .filter((r) => ALLOWED_HOSTS_RE.test(r.url))
    // Drop the github.com source itself — that's the project, not a mention.
    .filter((r) => !/\bgithub\.com\b/i.test(r.url))
    // Keep results where the title or content actually mentions the
    // project. False matches on title-only are common.
    .filter((r) => {
      const hay = `${r.title} ${r.content ?? ""}`.toLowerCase();
      const needle = title.toLowerCase();
      return hay.includes(needle) || hay.includes(repoFullName.toLowerCase());
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, MAX_MENTIONS_PER_PROJECT);

  return filtered.map<WebMention>((r) => ({
    title: r.title.slice(0, 240),
    url: r.url,
    source: friendlySourceLabel(r.url),
    snippet: r.content?.slice(0, 400),
  }));
}

function friendlySourceLabel(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.replace(/^www\./, "");
    if (host.includes("news.ycombinator")) return "Hacker News";
    if (host.includes("producthunt")) return "Product Hunt";
    if (host.includes("reddit")) return "Reddit";
    if (host.includes("dev.to")) return "dev.to";
    if (host.includes("hashnode")) return "Hashnode";
    if (host.includes("substack")) return "Substack";
    if (host.includes("medium")) return "Medium";
    if (host.includes("techcrunch")) return "TechCrunch";
    if (host.includes("theverge")) return "The Verge";
    if (host.includes("wired")) return "Wired";
    if (host.includes("arstechnica")) return "Ars Technica";
    if (host.includes("hackernoon")) return "Hackernoon";
    return host;
  } catch {
    return "Web";
  }
}
