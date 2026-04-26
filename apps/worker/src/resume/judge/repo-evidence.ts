/**
 * Per-repo external evidence — runs after Kimi's structural judgment.
 *
 * Uses Gemini 3 Flash Preview via OpenRouter with Google Search +
 * URL context grounding (`google/gemini-3-flash-preview:online`).
 * Pulled separately from the Kimi judge so a Gemini outage doesn't
 * lose the structural verdict.
 *
 * Anti-hallucination: prompt forces NO_INFO_FOUND on missing data and
 * requires URL-cited mentions only. The client-side guard (in
 * gemini-grounded.ts) flags the sentinel.
 *
 * The output feeds the Sonnet project-ranker so it can answer:
 *   - Is this project famous (Hacker News, Product Hunt, press)?
 *   - Is it niche / personal / pre-product (no external traction)?
 *   - Is there novelty signal (first OSS X for Y, paper accepted at Z)?
 */

import pLimit from "p-limit";
import { callGroundedGemini } from "@gitshow/shared/cloud/gemini-grounded";
import type { GroundedSource } from "@gitshow/shared/cloud/gemini-grounded";
import type { ScanTrace } from "../observability/trace.js";
import type { RepoJudgeOutput } from "./repo-judge.js";

export type Reception = "viral" | "notable" | "niche" | "unknown";

export interface EvidenceMention {
  title: string;
  url: string;
  /** Hostname-derived label ("Hacker News", "Product Hunt", host). */
  source: string;
}

export interface RepoEvidence {
  /** True when Gemini found anything beyond the GitHub page itself. */
  hasExternalInfo: boolean;
  /** Coarse external-traction band — drives ranker's "famous" axis. */
  reception: Reception;
  /** Up to 5 high-signal mentions. */
  mentions: EvidenceMention[];
  /** Compact markdown report (≤2KB) suitable for inclusion in ranker prompt. */
  reportMarkdown: string;
  /**
   * `true` when Gemini returned the literal NO_INFO_FOUND sentinel.
   * Distinct from `hasExternalInfo: false` — the latter can also mean
   * Gemini wrote a report saying "I found the GitHub repo only".
   */
  rawNoInfo: boolean;
  /** Number of attempts (1 = first try). */
  attempts: number;
  /** Wall-clock for the Gemini call. */
  durationMs: number;
}

/** Repo kinds we never bother investigating — pure noise. */
const SKIP_EVIDENCE_KINDS = new Set([
  "empty-or-trivial",
  "contribution-mirror",
  "dotfiles-config",
]);

/**
 * Per-repo Gemini grounded calls fan out wide.
 *
 * Empirical evidence from the last full scan (47 calls, 4-14s each,
 * 0 throttling): OpenRouter handles concurrent Gemini grounded
 * traffic without complaint, and the worker had 96% memory free at
 * peak. Bumped from 30 → 75 to use that headroom — for a 50-repo
 * evidence pass, 75 concurrent means basically every call runs in
 * parallel and the wall-clock for the stage is bounded by a single
 * call's latency (~10s) rather than batching.
 *
 * The retry policy in gemini-grounded.ts absorbs occasional 429s
 * without losing data, so going wide here is genuinely free.
 */
const PER_REPO_CONCURRENCY = 100;

const SYSTEM_PROMPT = `You investigate a software project and produce a short, fact-grounded
external-traction report.

You will be given the project's GitHub URL, an optional homepage URL, the
repo full name, and a one-line description from the repo itself. Your job:

1. Use the URL context tool on the provided URLs and the Google Search
   tool to find what the wider internet says about this project.
2. Summarize, in 2-4 sentences, what the project is and whether anyone
   outside the repo author talks about it.
3. List up to 5 specific external mentions (Hacker News, Product Hunt,
   dev.to, Reddit, blog posts, news, podcasts, papers). For each, give
   title and URL. NEVER fabricate a URL — if you can't find a real one,
   omit the entry.
4. Note novelty signals if any: "first OSS implementation of …", "cited
   in paper X", "won hackathon Y".

Output format — markdown with these exact section headings:

## Reception
One word: viral | notable | niche | unknown
(viral = HN front page / 1k+ stars + press / viral tweets;
 notable = mentioned on dev.to / podcasts / multiple blog posts;
 niche = some external mentions but small audience;
 unknown = no external info beyond the GitHub repo itself)

## Summary
2-4 sentences. What the project is and whether the world has noticed.

## Mentions
- [Title](URL) — source
- ...
(omit this section entirely if there are no real mentions)

## Novelty
- One bullet per novelty signal, or omit if none.

Hard rules:
- If you genuinely cannot find any external information about this project
  beyond the GitHub repo itself, return EXACTLY: NO_INFO_FOUND
- Never invent stars, downloads, citations, or mentions.
- Quote the source for every claim.
- Stay strictly on topic. Don't pad with generic "developer tools are
  important" prose.`;

export interface FetchEvidenceInput {
  judgments: Record<string, RepoJudgeOutput>;
  trace?: ScanTrace;
  log?: (s: string) => void;
}

export async function fetchAllRepoEvidence(
  input: FetchEvidenceInput,
): Promise<Record<string, RepoEvidence>> {
  const log = input.log ?? (() => {});
  const candidates = Object.entries(input.judgments).filter(
    ([, j]) => !SKIP_EVIDENCE_KINDS.has(j.judgment.kind),
  );
  log(`[repo-evidence] running on ${candidates.length}/${Object.keys(input.judgments).length} repos\n`);

  const limit = pLimit(PER_REPO_CONCURRENCY);
  const out: Record<string, RepoEvidence> = {};
  await Promise.all(
    candidates.map(([fullName, j]) =>
      limit(async () => {
        try {
          const evidence = await fetchOneRepoEvidence({
            repoFullName: fullName,
            description: j.repo.description ?? undefined,
            stars: j.repo.stargazerCount ?? 0,
            log,
          });
          out[fullName] = evidence;
          input.trace?.note(
            `evidence:${fullName}`,
            `reception=${evidence.reception} mentions=${evidence.mentions.length} attempts=${evidence.attempts}`,
            {
              hasExternalInfo: evidence.hasExternalInfo,
              rawNoInfo: evidence.rawNoInfo,
              reception: evidence.reception,
              mentionCount: evidence.mentions.length,
              durationMs: evidence.durationMs,
              attempts: evidence.attempts,
            },
          );
          log(
            `[repo-evidence] ${fullName}: reception=${evidence.reception} mentions=${evidence.mentions.length}\n`,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log(`[repo-evidence] ${fullName} FAILED: ${msg.slice(0, 160)}\n`);
          input.trace?.note(
            `evidence-error:${fullName}`,
            `gemini grounded call failed for ${fullName}: ${msg.slice(0, 240)}`,
            { error: msg },
          );
          // Surface a synthetic "unknown" so the ranker doesn't lose
          // the repo entirely. This is the only place we accept the
          // partial-result tradeoff — Gemini is meant to always be
          // available, but a per-repo failure shouldn't cascade.
          out[fullName] = {
            hasExternalInfo: false,
            reception: "unknown",
            mentions: [],
            reportMarkdown: `## Reception\nunknown\n\n## Summary\nGemini grounding call failed.`,
            rawNoInfo: false,
            attempts: 0,
            durationMs: 0,
          };
        }
      }),
    ),
  );
  return out;
}

interface FetchOneInput {
  repoFullName: string;
  description?: string;
  stars: number;
  log: (s: string) => void;
}

async function fetchOneRepoEvidence(
  input: FetchOneInput,
): Promise<RepoEvidence> {
  const githubUrl = `https://github.com/${input.repoFullName}`;

  const userPrompt = [
    `Project: ${input.repoFullName}`,
    `GitHub: ${githubUrl}`,
    `GitHub stars: ${input.stars}`,
    input.description ? `Description (verbatim from repo): ${input.description}` : "",
    "",
    `Investigate this project. Read the GitHub repo via URL context, then`,
    `search for external mentions (HN, Product Hunt, dev.to, blog posts,`,
    `press, podcasts, papers). Produce the markdown report per the system`,
    `prompt.`,
  ]
    .filter(Boolean)
    .join("\n");

  const result = await callGroundedGemini({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    urls: [githubUrl],
    effort: "medium",
    label: `evidence:${input.repoFullName}`,
  });

  if (result.noInfoFound) {
    return {
      hasExternalInfo: false,
      reception: "unknown",
      mentions: [],
      reportMarkdown: "## Reception\nunknown\n\n## Summary\nNo external information found beyond the GitHub repo itself.",
      rawNoInfo: true,
      attempts: result.attempts,
      durationMs: result.durationMs,
    };
  }

  const reception = parseReception(result.text);
  const mentions = parseMentions(result.text, result.sources);
  return {
    hasExternalInfo: mentions.length > 0 || reception !== "unknown",
    reception,
    mentions,
    reportMarkdown: trimMarkdown(result.text),
    rawNoInfo: false,
    attempts: result.attempts,
    durationMs: result.durationMs,
  };
}

const RECEPTION_RE = /##\s*Reception\s*\n+\s*(viral|notable|niche|unknown)/i;
function parseReception(md: string): Reception {
  const m = md.match(RECEPTION_RE);
  if (!m) return "unknown";
  const v = m[1].toLowerCase();
  if (v === "viral" || v === "notable" || v === "niche") return v;
  return "unknown";
}

const MENTION_LINE_RE = /^\s*-\s*\[([^\]]+)\]\((https?:\/\/[^)]+)\)\s*(?:[—–-]\s*(.+))?$/;
const MENTIONS_SECTION_RE = /##\s*Mentions\s*\n([\s\S]*?)(?=\n##\s|$)/i;
function parseMentions(md: string, sources: GroundedSource[]): EvidenceMention[] {
  const mentions: EvidenceMention[] = [];
  const sec = md.match(MENTIONS_SECTION_RE);
  if (sec) {
    for (const line of sec[1].split("\n")) {
      const m = line.match(MENTION_LINE_RE);
      if (!m) continue;
      mentions.push({
        title: m[1].slice(0, 240),
        url: m[2],
        source: m[3]?.trim().slice(0, 60) ?? hostLabel(m[2]),
      });
    }
  }
  // Also consume any URL annotations from grounding metadata that the
  // model didn't surface in the markdown body — those are the most
  // reliable cited URLs from Gemini's URL context tool.
  const seen = new Set(mentions.map((m) => m.url));
  for (const s of sources) {
    if (seen.has(s.url)) continue;
    if (mentions.length >= 5) break;
    mentions.push({
      title: s.title?.slice(0, 240) ?? hostLabel(s.url),
      url: s.url,
      source: hostLabel(s.url),
    });
  }
  return mentions.slice(0, 5);
}

function hostLabel(rawUrl: string): string {
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
    return host;
  } catch {
    return "Web";
  }
}

function trimMarkdown(s: string): string {
  if (s.length <= 2_000) return s.trim();
  return `${s.slice(0, 1_997).trim()}…`;
}
