/**
 * stackoverflow fetcher — Stack Exchange API for user reputation + skills.
 *
 * Two unauthenticated API hits:
 *   1. `/users/{id}` → reputation, display name
 *   2. `/users/{id}/top-tags` → weighted skill tags
 *
 * Emits:
 *   - HAS_SKILL for each top tag (up to 10), weighted by tag_score
 *   - WON Achievement(rep-milestone) if reputation > 10k
 */

import { makeSource } from "@gitshow/shared/kg";
import type { TypedFact } from "@gitshow/shared/kg";
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

const API_TIMEOUT_MS = 30_000;
const REP_MILESTONE_THRESHOLD = 10_000;

interface SeApiResponse<T> {
  items?: T[];
  has_more?: boolean;
  quota_max?: number;
  quota_remaining?: number;
}

interface SeUser {
  user_id: number;
  display_name?: string;
  reputation?: number;
  location?: string;
  link?: string;
  profile_image?: string;
}

interface SeTopTag {
  tag_name: string;
  question_score?: number;
  answer_score?: number;
  question_count?: number;
  answer_count?: number;
}

export async function runStackoverflowFetcher(
  input: FetcherInput,
): Promise<TypedFact[]> {
  const label = "stackoverflow";
  const t0 = Date.now();
  const raw = input.session.socials.stackoverflow;
  const log = input.onProgress ?? (() => {});
  const trace = input.trace;

  const userId = parseUserId(raw);
  trace?.fetcherStart({ label, input: { raw, userId } });

  if (!userId) {
    trace?.fetcherEnd({
      label,
      durationMs: Date.now() - t0,
      factsEmitted: 0,
      status: "empty",
    });
    return [];
  }

  try {
    const userRes = await fetch(
      `https://api.stackexchange.com/2.3/users/${userId}?site=stackoverflow`,
      { signal: AbortSignal.timeout(API_TIMEOUT_MS) },
    );
    if (!userRes.ok) {
      trace?.fetcherEnd({
        label,
        durationMs: Date.now() - t0,
        factsEmitted: 0,
        status: "empty",
      });
      return [];
    }
    const userData = (await userRes.json()) as SeApiResponse<SeUser>;
    const user = userData.items?.[0];
    if (!user) {
      trace?.fetcherEnd({
        label,
        durationMs: Date.now() - t0,
        factsEmitted: 0,
        status: "empty",
      });
      return [];
    }

    const tagsRes = await fetch(
      `https://api.stackexchange.com/2.3/users/${userId}/top-tags?site=stackoverflow&pagesize=15`,
      { signal: AbortSignal.timeout(API_TIMEOUT_MS) },
    );
    const tagsData = tagsRes.ok
      ? ((await tagsRes.json()) as SeApiResponse<SeTopTag>)
      : { items: [] as SeTopTag[] };
    const tags = (tagsData.items ?? [])
      .map((t) => ({
        name: t.tag_name,
        score:
          (t.answer_score ?? 0) * 2 + (t.question_score ?? 0),
      }))
      .filter((t) => t.name)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    const profileUrl =
      user.link ?? `https://stackoverflow.com/users/${userId}`;
    const src = (snippet?: string) =>
      makeSource({
        fetcher: "stackoverflow",
        method: "api",
        confidence: "medium",
        url: profileUrl,
        snippet,
      });

    const facts: TypedFact[] = [];

    // Top tags → HAS_SKILL
    for (const tag of tags) {
      facts.push({
        kind: "HAS_SKILL",
        skill: { canonicalName: tag.name },
        attrs: { weight: tag.score },
        source: src(`Stack Overflow top tag: ${tag.name} (score ${tag.score})`),
      });
    }

    // Reputation milestone → WON Achievement
    if ((user.reputation ?? 0) >= REP_MILESTONE_THRESHOLD) {
      const rep = user.reputation ?? 0;
      facts.push({
        kind: "WON",
        achievement: {
          title: `Stack Overflow ${rep.toLocaleString()} reputation`,
          kind: "rep-milestone",
          repUnit: rep,
          url: profileUrl,
        },
        attrs: {},
        source: src(`reputation: ${rep}`),
      });
    }

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

function parseUserId(raw: string | undefined): number | null {
  if (!raw) return null;
  const match = raw.match(/\/users\/(\d+)/);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isFinite(id) && id > 0 ? id : null;
}
