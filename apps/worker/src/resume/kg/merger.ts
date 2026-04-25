/**
 * KG Merger — fuses TypedFacts from many fetchers into one KnowledgeGraph.
 *
 * Two passes per entity bucket:
 *   1. Deterministic — exact name / slug / domain match.
 *   2. LLM pair resolution (Opus, single call) — ambiguous pairs only.
 *
 * Then build edges from the typed facts, attach sources, derive bands,
 * and resolve attribute conflicts by source priority.
 *
 * The merger is deliberately stateless: input → KnowledgeGraph. No I/O.
 */

import * as z from "zod/v4";

import { runAgentWithSubmit, type AgentEventEmit } from "../../agents/base.js";
import type { ScanSession } from "../../schemas.js";
import type { SessionUsage } from "../../session.js";
import { modelForRole } from "@gitshow/shared/models";
import {
  deriveBand,
  emptyKG,
  type Achievement,
  type Company,
  type Edge,
  type EdgeType,
  type Event as KGEvent,
  type KnowledgeGraph,
  type KnowledgeGraphMeta,
  type PairResolution,
  type Person,
  type Project,
  type Publication,
  type Repository,
  type Role,
  type School,
  type Skill,
  type Source,
} from "@gitshow/shared/kg";
import {
  achievementId,
  companyId,
  edgeId,
  eventId,
  personId,
  projectId,
  publicationId,
  repositoryId,
  roleId,
  schoolId,
  skillId,
  slug,
} from "@gitshow/shared/kg";
import type {
  AuthoredFact,
  BuiltFact,
  ContributedToFact,
  CoBuiltWithFact,
  HasSkillFact,
  LivesInFact,
  OperatesFact,
  PersonFact,
  StudiedAtFact,
  TypedFact,
  WonFact,
  WorkedAtFact,
  AttendedFact,
} from "@gitshow/shared/kg";
import type { ScanTrace } from "../observability/trace.js";

// ─── Source priority for conflict resolution ───────────────────────────
// Display value comes from the highest-priority source; lower-ranked
// sources still attach for evidence count.

const SOURCE_PRIORITY: Record<string, number> = {
  intake: 100,
  "linkedin-pdf": 90,
  "personal-site": 80,
  "linkedin-public": 60,
  orcid: 55,
  "semantic-scholar": 50,
  arxiv: 50,
  stackoverflow: 50,
  github: 45,
  "github-fetcher": 45,
  "evidence-search": 40,
  twitter: 35,
  youtube: 30,
  hn: 30,
  devto: 30,
  medium: 30,
  "blog-import": 30,
  "github-hint": 20,
  "repo-judge": 70,
  "media-fetch": 0,
};

function priorityOf(s: Source): number {
  return SOURCE_PRIORITY[s.fetcher] ?? 0;
}

function pickHighestPrioritySource(sources: Source[]): Source | undefined {
  if (sources.length === 0) return undefined;
  return [...sources].sort((a, b) => priorityOf(b) - priorityOf(a))[0];
}

// ─── Public API ────────────────────────────────────────────────────────

export interface MergeOptions {
  session: ScanSession;
  usage: SessionUsage;
  meta: KnowledgeGraphMeta;
  trace?: ScanTrace;
  /** Disable the LLM pair-resolution pass (tests / cheap runs). */
  skipLlmResolution?: boolean;
  /** Cap on ambiguous pairs sent to the LLM. */
  pairCap?: number;
  onProgress?: (text: string) => void;
  /** Optional structured emit (reasoning + tool events). */
  emit?: AgentEventEmit;
}

export async function mergeFactsIntoKG(
  facts: TypedFact[],
  opts: MergeOptions,
): Promise<KnowledgeGraph> {
  const kg = emptyKG(opts.meta);

  // Add the Person node first — every scan has at least one.
  const handle = opts.session.handle;
  kg.entities.persons.push({
    id: personId(handle),
    handle,
    discoverable: false,
  });

  // Bucket facts by kind for clarity.
  const byKind = bucketByKind(facts);

  // 1) Person patches
  applyPersonFacts(kg, byKind.PERSON ?? []);
  applyLivesIn(kg, byKind.LIVES_IN ?? []);

  // 2) Company / School / Project / Skill / Achievement / Event / Publication / Repository entities
  upsertCompanies(kg, [...(byKind.WORKED_AT ?? []), ...(byKind.OPERATES ?? [])]);
  upsertSchools(kg, byKind.STUDIED_AT ?? []);
  upsertProjects(kg, [...(byKind.BUILT ?? []), ...(byKind.CO_BUILT_WITH ?? [])]);
  upsertRepositories(kg, byKind.CONTRIBUTED_TO ?? []);
  upsertSkills(kg, byKind.HAS_SKILL ?? []);
  upsertPublications(kg, byKind.AUTHORED ?? []);
  upsertAchievementsAndEvents(kg, byKind.WON ?? [], byKind.ATTENDED ?? []);

  // 3) Deterministic merge across like-bucket entities.
  const detResult = deterministicMerge(kg);
  opts.trace?.kgMergerDeterministic({
    label: "kg.merger.deterministic",
    mergedPairs: detResult.merged,
    retainedPairs: detResult.retained,
  });

  // 4) LLM pair-resolution for ambiguous Company/School pairs.
  if (!opts.skipLlmResolution) {
    const ambiguous = collectAmbiguousPairs(kg, opts.pairCap ?? 20);
    if (ambiguous.length > 0) {
      const decisions = await runPairResolution(ambiguous, {
        session: opts.session,
        usage: opts.usage,
        trace: opts.trace,
        onProgress: opts.onProgress,
        emit: opts.emit,
      });
      kg.resolved.pairs.push(...decisions);
      applyPairDecisions(kg, decisions);
      opts.trace?.kgMergerLlm({
        label: "kg.merger.llm",
        pairCount: ambiguous.length,
        decisions: decisions.map((d) => ({
          a: d.a,
          b: d.b,
          decision: d.decision,
          rationale: d.rationale,
        })),
      });
    } else {
      opts.trace?.kgMergerLlm({
        label: "kg.merger.llm",
        pairCount: 0,
        decisions: [],
      });
    }
  }

  // 5) Edges
  buildEdges(kg, byKind);

  // 6) Confidence band per edge (already done in buildEdges, but emit trace events for visibility).
  for (const e of kg.edges) {
    opts.trace?.kgEdgeResolved({
      label: `kg.edge:${e.type}`,
      edgeId: e.id,
      edgeType: e.type,
      sourceCount: e.sources.length,
      band: e.band,
    });
  }

  return kg;
}

// ─── Bucketing ─────────────────────────────────────────────────────────

type FactsByKind = {
  PERSON?: PersonFact[];
  WORKED_AT?: WorkedAtFact[];
  STUDIED_AT?: StudiedAtFact[];
  BUILT?: BuiltFact[];
  CONTRIBUTED_TO?: ContributedToFact[];
  LIVES_IN?: LivesInFact[];
  HAS_SKILL?: HasSkillFact[];
  WON?: WonFact[];
  CO_BUILT_WITH?: CoBuiltWithFact[];
  AUTHORED?: AuthoredFact[];
  OPERATES?: OperatesFact[];
  ATTENDED?: AttendedFact[];
};

function bucketByKind(facts: TypedFact[]): FactsByKind {
  const out: FactsByKind = {};
  for (const f of facts) {
    const arr = (out[f.kind] ?? (out[f.kind] = [])) as TypedFact[];
    arr.push(f);
  }
  return out;
}

// ─── Person patches ────────────────────────────────────────────────────

function applyPersonFacts(kg: KnowledgeGraph, facts: PersonFact[]): void {
  if (kg.entities.persons.length === 0) return;
  const p = kg.entities.persons[0];
  const sorted = [...facts].sort((a, b) => priorityOf(b.source) - priorityOf(a.source));
  for (const f of sorted) {
    const patch = f.person;
    if (!p.name && patch.name) p.name = patch.name;
    if (!p.bio && patch.bio) p.bio = patch.bio;
    if (!p.location && patch.location) p.location = patch.location;
    if (!p.avatarUrl && patch.avatarUrl) p.avatarUrl = patch.avatarUrl;
    if (!p.url && patch.url) p.url = patch.url;
    if (!p.email && patch.email) p.email = patch.email;
    if (!p.initials && patch.initials) p.initials = patch.initials;
  }
  if (!p.initials && p.name) {
    p.initials = p.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("");
  }
}

function applyLivesIn(kg: KnowledgeGraph, facts: LivesInFact[]): void {
  if (kg.entities.persons.length === 0) return;
  const p = kg.entities.persons[0];
  if (p.location) return;
  const top = [...facts].sort((a, b) => priorityOf(b.source) - priorityOf(a.source))[0];
  if (top) p.location = top.location;
}

// ─── Upsert helpers ────────────────────────────────────────────────────

function upsertCompanies(
  kg: KnowledgeGraph,
  facts: Array<WorkedAtFact | OperatesFact>,
): void {
  for (const f of facts) {
    const id = companyId({ name: f.company.canonicalName, domain: f.company.domain });
    let existing = kg.entities.companies.find((c) => c.id === id);
    if (!existing) {
      existing = {
        id,
        canonicalName: f.company.canonicalName,
        domain: f.company.domain,
        aliases: f.company.aliases ?? [],
        description: f.company.description,
      };
      kg.entities.companies.push(existing);
    } else {
      if (f.company.domain && !existing.domain) existing.domain = f.company.domain;
      if (f.company.description && !existing.description)
        existing.description = f.company.description;
      // accumulate aliases
      const aliasSet = new Set([
        ...(existing.aliases ?? []),
        ...(f.company.aliases ?? []),
      ]);
      if (existing.canonicalName !== f.company.canonicalName) {
        aliasSet.add(f.company.canonicalName);
      }
      existing.aliases = [...aliasSet];
    }
  }
}

function upsertSchools(kg: KnowledgeGraph, facts: StudiedAtFact[]): void {
  for (const f of facts) {
    const id = schoolId({ name: f.school.canonicalName, domain: f.school.domain });
    let existing = kg.entities.schools.find((s) => s.id === id);
    if (!existing) {
      existing = {
        id,
        canonicalName: f.school.canonicalName,
        domain: f.school.domain,
        aliases: f.school.aliases ?? [],
      };
      kg.entities.schools.push(existing);
    } else {
      if (f.school.domain && !existing.domain) existing.domain = f.school.domain;
      const aliasSet = new Set([
        ...(existing.aliases ?? []),
        ...(f.school.aliases ?? []),
      ]);
      existing.aliases = [...aliasSet];
    }
  }
}

function upsertProjects(
  kg: KnowledgeGraph,
  facts: Array<BuiltFact | CoBuiltWithFact>,
): void {
  for (const f of facts) {
    const proj = f.project;
    const id = projectId({ repoFullName: proj.repoFullName, title: proj.title });
    let existing = kg.entities.projects.find((p) => p.id === id);
    if (!existing) {
      existing = {
        id,
        title: proj.title,
        purpose: proj.purpose ?? "",
        kind: proj.kind ?? "experiment",
        polish: proj.polish ?? "wip",
        shouldFeature: false,
        reason: proj.reason,
        dates: proj.dates,
        tags: proj.tags ?? [],
        repoFullName: proj.repoFullName,
        homepageUrl: proj.homepageUrl,
      };
      kg.entities.projects.push(existing);
    } else {
      if (!existing.purpose && proj.purpose) existing.purpose = proj.purpose;
      if (!existing.homepageUrl && proj.homepageUrl)
        existing.homepageUrl = proj.homepageUrl;
      if (!existing.repoFullName && proj.repoFullName)
        existing.repoFullName = proj.repoFullName;
      const tagSet = new Set([...(existing.tags ?? []), ...(proj.tags ?? [])]);
      existing.tags = [...tagSet];
    }
  }
}

function upsertRepositories(kg: KnowledgeGraph, facts: ContributedToFact[]): void {
  for (const f of facts) {
    const r = f.repository;
    const id = repositoryId(r.fullName);
    let existing = kg.entities.repositories.find((x) => x.id === id);
    if (!existing) {
      existing = {
        id,
        fullName: r.fullName,
        primaryLanguage: r.primaryLanguage,
        isPrivate: r.isPrivate ?? false,
        isFork: r.isFork ?? false,
        isArchived: r.isArchived ?? false,
        stars: r.stars ?? 0,
        pushedAt: r.pushedAt,
        description: r.description,
        homepageUrl: r.homepageUrl,
        userCommitCount: r.userCommitCount,
      };
      kg.entities.repositories.push(existing);
    }
  }
}

function upsertSkills(kg: KnowledgeGraph, facts: HasSkillFact[]): void {
  for (const f of facts) {
    const id = skillId(f.skill.canonicalName);
    let existing = kg.entities.skills.find((s) => s.id === id);
    if (!existing) {
      existing = {
        id,
        canonicalName: f.skill.canonicalName,
        category: f.skill.category,
        iconKey: f.skill.iconKey,
      };
      kg.entities.skills.push(existing);
    }
    // The manifest-skills aggregator emits HAS_SKILL facts with
    // usageCount + score precomputed. When that fact wins (via the
    // sources priority order — github-fetcher is high), promote the
    // numeric fields onto the Skill entity so the renderer can sort
    // and the UI can render bars.
    if (
      f.skill.usageCount !== undefined &&
      (existing.usageCount === undefined || f.skill.usageCount > existing.usageCount)
    ) {
      existing.usageCount = f.skill.usageCount;
    }
    if (
      f.skill.score !== undefined &&
      (existing.score === undefined || f.skill.score > existing.score)
    ) {
      existing.score = f.skill.score;
    }
  }
}

function upsertPublications(kg: KnowledgeGraph, facts: AuthoredFact[]): void {
  for (const f of facts) {
    const id = publicationId({ url: f.publication.url, title: f.publication.title, doi: f.publication.doi });
    let existing = kg.entities.publications.find((p) => p.id === id);
    if (!existing) {
      existing = {
        id,
        title: f.publication.title,
        url: f.publication.url,
        kind: f.publication.kind,
        platform: f.publication.platform,
        publishedAt: f.publication.publishedAt,
        body: f.publication.body,
        summary: f.publication.summary,
        venue: f.publication.venue,
        doi: f.publication.doi,
        arxivId: f.publication.arxivId,
        coAuthors: f.publication.coAuthors ?? [],
        imageUrl: f.publication.imageUrl,
      };
      kg.entities.publications.push(existing);
    }
  }
}

function upsertAchievementsAndEvents(
  kg: KnowledgeGraph,
  wonFacts: WonFact[],
  attendedFacts: AttendedFact[],
): void {
  for (const f of wonFacts) {
    const id = achievementId({ title: f.achievement.title, date: f.achievement.date });
    if (!kg.entities.achievements.find((a) => a.id === id)) {
      kg.entities.achievements.push({
        id,
        title: f.achievement.title,
        kind: f.achievement.kind,
        date: f.achievement.date,
        description: f.achievement.description,
        url: f.achievement.url,
        location: f.achievement.location,
        repUnit: f.achievement.repUnit,
      });
    }
    if (f.event?.name) {
      const evId = eventId({ name: f.event.name, date: f.event.date });
      if (!kg.entities.events.find((e) => e.id === evId)) {
        kg.entities.events.push({
          id: evId,
          name: f.event.name,
          kind: f.event.kind ?? "hackathon",
          date: f.event.date,
          location: f.event.location,
          url: f.event.url,
        });
      }
    }
  }
  for (const f of attendedFacts) {
    const id = eventId({ name: f.event.name, date: f.event.date });
    if (!kg.entities.events.find((e) => e.id === id)) {
      kg.entities.events.push({
        id,
        name: f.event.name,
        kind: f.event.kind,
        date: f.event.date,
        location: f.event.location,
        url: f.event.url,
      });
    }
  }
}

// ─── Deterministic merge ────────────────────────────────────────────────

function deterministicMerge(kg: KnowledgeGraph): { merged: number; retained: number } {
  let merged = 0;
  // Companies: merge by domain or by canonical-slug match if domain absent.
  const companies = kg.entities.companies;
  const seen = new Map<string, Company>();
  for (const c of companies) {
    const key = c.domain ? `dom:${slug(c.domain)}` : `name:${slug(c.canonicalName)}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, c);
    } else {
      mergeCompanyInto(existing, c);
      merged++;
    }
  }
  kg.entities.companies = [...seen.values()];

  // Schools: same idea.
  const schools = kg.entities.schools;
  const sSeen = new Map<string, School>();
  for (const s of schools) {
    const key = s.domain ? `dom:${slug(s.domain)}` : `name:${slug(s.canonicalName)}`;
    const existing = sSeen.get(key);
    if (!existing) {
      sSeen.set(key, s);
    } else {
      mergeSchoolInto(existing, s);
      merged++;
    }
  }
  kg.entities.schools = [...sSeen.values()];

  // ── Project dedupe ──────────────────────────────────────────────
  // Personal-site fetcher emits BUILT facts without a repoFullName,
  // so the project's id is `proj:{slug(title)}`. github-fetcher
  // emits BUILT for the same conceptual project but WITH a
  // repoFullName, giving id `proj:{slug(owner-name)}`. Different
  // ids, same project — both rendered, twitterGPT/aimuse/pikc/tevo
  // appeared in BOTH My Projects and Build Log.
  //
  // Heuristic: when a project has no repoFullName and its slugged
  // title matches the LAST PATH SEGMENT of any other project that
  // does have a repoFullName, merge the standalone into the
  // repo-tied one (the repo-tied carries more signal — Judge
  // verdict, languages, dates).
  const projects = kg.entities.projects;
  const repoTied = projects.filter((p) => p.repoFullName);
  const standalone = projects.filter((p) => !p.repoFullName);
  // index repo-tied by normalised "name part" for quick lookup
  const byNamePart = new Map<string, typeof repoTied[number]>();
  for (const p of repoTied) {
    const repoName = (p.repoFullName ?? "").split("/").pop() ?? "";
    const k = slug(repoName);
    if (!byNamePart.has(k)) byNamePart.set(k, p);
    // Also key by normalised display title so e.g. "Aimuse Ethforall
    // 2023 Winner" still matches a personal-site "aimuse" entry.
    const tk = slug(p.title);
    if (!byNamePart.has(tk)) byNamePart.set(tk, p);
  }
  const projDropIds = new Set<string>();
  for (const sp of standalone) {
    const k = slug(sp.title);
    if (!k) continue;
    let target = byNamePart.get(k);
    if (!target) {
      // Fallback: prefix match — "aimuse" vs "aimuse-ethforall-2023"
      for (const [key, p] of byNamePart) {
        if (key.startsWith(k + "-") || k.startsWith(key + "-")) {
          target = p;
          break;
        }
      }
    }
    if (!target) continue;
    // Merge: keep the repo-tied project's id; promote any richer
    // copy from the standalone (e.g. cleaner purpose text from the
    // user's own site) when the repo-tied entry lacks it.
    if (!target.purpose && sp.purpose) target.purpose = sp.purpose;
    if (!target.homepageUrl && sp.homepageUrl) target.homepageUrl = sp.homepageUrl;
    projDropIds.add(sp.id);
    merged++;
  }
  if (projDropIds.size > 0) {
    kg.entities.projects = projects.filter((p) => !projDropIds.has(p.id));
    // Redirect any edges that pointed at the dropped IDs to their
    // canonical target so we don't dangle.
    const standaloneToTarget = new Map<string, string>();
    for (const sp of standalone) {
      if (!projDropIds.has(sp.id)) continue;
      const k = slug(sp.title);
      let t = byNamePart.get(k);
      if (!t) {
        for (const [key, p] of byNamePart) {
          if (key.startsWith(k + "-") || k.startsWith(key + "-")) {
            t = p;
            break;
          }
        }
      }
      if (t) standaloneToTarget.set(sp.id, t.id);
    }
    for (const e of kg.edges) {
      const remap = standaloneToTarget.get(e.to);
      if (remap) e.to = remap;
    }
  }

  return {
    merged,
    retained:
      kg.entities.companies.length +
      kg.entities.schools.length +
      kg.entities.projects.length,
  };
}

function mergeCompanyInto(into: Company, from: Company): void {
  if (!into.domain && from.domain) into.domain = from.domain;
  if (!into.description && from.description) into.description = from.description;
  const aliasSet = new Set([
    ...(into.aliases ?? []),
    ...(from.aliases ?? []),
    from.canonicalName,
  ]);
  aliasSet.delete(into.canonicalName);
  into.aliases = [...aliasSet];
}
function mergeSchoolInto(into: School, from: School): void {
  if (!into.domain && from.domain) into.domain = from.domain;
  const aliasSet = new Set([
    ...(into.aliases ?? []),
    ...(from.aliases ?? []),
    from.canonicalName,
  ]);
  aliasSet.delete(into.canonicalName);
  into.aliases = [...aliasSet];
}

// ─── LLM pair resolution ────────────────────────────────────────────────

interface AmbiguousPair {
  kind: "company" | "school";
  a: { id: string; name: string; aliases: string[]; domain?: string };
  b: { id: string; name: string; aliases: string[]; domain?: string };
}

function collectAmbiguousPairs(kg: KnowledgeGraph, cap: number): AmbiguousPair[] {
  const pairs: AmbiguousPair[] = [];
  const cs = kg.entities.companies;
  for (let i = 0; i < cs.length; i++) {
    for (let j = i + 1; j < cs.length; j++) {
      const a = cs[i];
      const b = cs[j];
      if (sameish(a.canonicalName, b.canonicalName)) continue;
      if (a.domain && b.domain) continue; // both have distinct domains → leave separate
      // Aliases overlap is a hint of fusion candidacy.
      const overlap = (a.aliases ?? []).some((al) => sameish(al, b.canonicalName)) ||
        (b.aliases ?? []).some((bl) => sameish(bl, a.canonicalName));
      if (overlap || nameClose(a.canonicalName, b.canonicalName)) {
        pairs.push({
          kind: "company",
          a: { id: a.id, name: a.canonicalName, aliases: a.aliases ?? [], domain: a.domain },
          b: { id: b.id, name: b.canonicalName, aliases: b.aliases ?? [], domain: b.domain },
        });
        if (pairs.length >= cap) return pairs;
      }
    }
  }
  const ss = kg.entities.schools;
  for (let i = 0; i < ss.length; i++) {
    for (let j = i + 1; j < ss.length; j++) {
      const a = ss[i];
      const b = ss[j];
      if (sameish(a.canonicalName, b.canonicalName)) continue;
      if (a.domain && b.domain) continue;
      if (nameClose(a.canonicalName, b.canonicalName)) {
        pairs.push({
          kind: "school",
          a: { id: a.id, name: a.canonicalName, aliases: a.aliases ?? [], domain: a.domain },
          b: { id: b.id, name: b.canonicalName, aliases: b.aliases ?? [], domain: b.domain },
        });
        if (pairs.length >= cap) return pairs;
      }
    }
  }
  return pairs;
}

function sameish(a: string, b: string): boolean {
  return slug(a) === slug(b);
}

function nameClose(a: string, b: string): boolean {
  const sa = slug(a);
  const sb = slug(b);
  if (sa.length === 0 || sb.length === 0) return false;
  if (sa.includes(sb) || sb.includes(sa)) return true;
  const aa = sa.split("-").filter((x) => x.length > 2);
  const bb = sb.split("-").filter((x) => x.length > 2);
  const overlap = aa.filter((t) => bb.includes(t)).length;
  return overlap >= 1 && overlap >= Math.min(aa.length, bb.length) / 2;
}

const PairResolutionListSchema = z.object({
  decisions: z.array(
    z.object({
      a: z.string(),
      b: z.string(),
      decision: z.enum(["merge", "separate", "unclear"]),
      rationale: z.string().min(2).max(280),
    }),
  ),
});

const PAIR_PROMPT = `You resolve whether two surface names refer to the same
entity (company or school). For each pair you'll see name + aliases + domain
(maybe). Decide:

  merge      — the same entity, just named differently
  separate   — clearly distinct entities
  unclear    — not enough evidence; default keep separate

Be careful: "Stripe" vs "Stripe.io" → merge.
"Google" vs "Google Cloud" → unclear (could be the same employer or a
specific division — pick separate unless one clearly subsumes the other).
"video-first podcast hosting platform" vs "Flightcast" → merge IF aliases
or context indicate the descriptor maps to the brand.

Output ONLY by calling submit_decisions.`;

async function runPairResolution(
  pairs: AmbiguousPair[],
  opts: {
    session: ScanSession;
    usage: SessionUsage;
    trace?: ScanTrace;
    onProgress?: (text: string) => void;
    emit?: AgentEventEmit;
  },
): Promise<PairResolution[]> {
  if (pairs.length === 0) return [];
  const input = pairs
    .map((p, i) => {
      return [
        `[${i + 1}] kind=${p.kind}`,
        `  a.id=${p.a.id}  name="${p.a.name}"  domain=${p.a.domain ?? "?"}`,
        `      aliases=${JSON.stringify(p.a.aliases.slice(0, 5))}`,
        `  b.id=${p.b.id}  name="${p.b.name}"  domain=${p.b.domain ?? "?"}`,
        `      aliases=${JSON.stringify(p.b.aliases.slice(0, 5))}`,
      ].join("\n");
    })
    .join("\n\n");

  const res = await runAgentWithSubmit({
    model: modelForRole("orchestrator"),
    systemPrompt: PAIR_PROMPT,
    input,
    submitToolName: "submit_decisions",
    submitToolDescription: "Submit one decision per pair, by id.",
    submitSchema: PairResolutionListSchema,
    reasoning: { effort: "medium" },
    session: opts.session,
    usage: opts.usage,
    onProgress: opts.onProgress,
    trace: opts.trace,
    emit: opts.emit,
    label: "kg:pair-resolve",
  });
  return res.result.decisions;
}

function applyPairDecisions(kg: KnowledgeGraph, decisions: PairResolution[]): void {
  for (const d of decisions) {
    if (d.decision !== "merge") continue;
    // Merge "b" into "a" — pick the lexicographically smaller id as the
    // canonical so the choice is deterministic across runs.
    const [keepId, dropId] = [d.a, d.b].sort();
    const isCompany = keepId.startsWith("co:") && dropId.startsWith("co:");
    const isSchool = keepId.startsWith("sc:") && dropId.startsWith("sc:");
    if (isCompany) {
      const a = kg.entities.companies.find((c) => c.id === keepId);
      const b = kg.entities.companies.find((c) => c.id === dropId);
      if (a && b) {
        mergeCompanyInto(a, b);
        kg.entities.companies = kg.entities.companies.filter((c) => c.id !== dropId);
      }
    } else if (isSchool) {
      const a = kg.entities.schools.find((s) => s.id === keepId);
      const b = kg.entities.schools.find((s) => s.id === dropId);
      if (a && b) {
        mergeSchoolInto(a, b);
        kg.entities.schools = kg.entities.schools.filter((s) => s.id !== dropId);
      }
    }
  }
}

// ─── Edge construction ─────────────────────────────────────────────────

function buildEdges(kg: KnowledgeGraph, facts: FactsByKind): void {
  const personIdValue = kg.entities.persons[0]?.id ?? personId(kg.meta.handle);

  // WORKED_AT
  for (const f of facts.WORKED_AT ?? []) {
    const coId = companyId({ name: f.company.canonicalName, domain: f.company.domain });
    const company = kg.entities.companies.find((c) => c.id === coId);
    if (!company) continue;
    const titleSlug = slug(f.attrs.role);
    let role = kg.entities.roles.find((r) => r.id === roleId(coId, f.attrs.role));
    if (!role && f.attrs.role) {
      role = {
        id: roleId(coId, f.attrs.role),
        title: f.attrs.role,
        normalizedTitle: titleSlug,
      };
      kg.entities.roles.push(role);
    }
    addEdgeWithAttrConflict(
      kg,
      "WORKED_AT",
      personIdValue,
      coId,
      titleSlug,
      f.source,
      f.attrs as Record<string, unknown>,
    );
  }

  // STUDIED_AT
  for (const f of facts.STUDIED_AT ?? []) {
    const sId = schoolId({ name: f.school.canonicalName, domain: f.school.domain });
    if (!kg.entities.schools.find((s) => s.id === sId)) continue;
    addEdgeWithAttrConflict(
      kg,
      "STUDIED_AT",
      personIdValue,
      sId,
      slug(f.attrs.degree ?? ""),
      f.source,
      f.attrs as Record<string, unknown>,
    );
  }

  // BUILT
  for (const f of facts.BUILT ?? []) {
    const pId = projectId({ repoFullName: f.project.repoFullName, title: f.project.title });
    if (!kg.entities.projects.find((p) => p.id === pId)) continue;
    addEdgeWithAttrConflict(
      kg,
      "BUILT",
      personIdValue,
      pId,
      "",
      f.source,
      (f.attrs ?? {}) as Record<string, unknown>,
    );
  }

  // CO_BUILT_WITH
  for (const f of facts.CO_BUILT_WITH ?? []) {
    const pId = projectId({ repoFullName: f.project.repoFullName, title: f.project.title });
    if (!kg.entities.projects.find((p) => p.id === pId)) continue;
    addEdgeWithAttrConflict(
      kg,
      "CO_BUILT_WITH",
      personIdValue,
      pId,
      slug(f.collaboratorHandle),
      f.source,
      { collaboratorHandle: f.collaboratorHandle } as Record<string, unknown>,
    );
  }

  // CONTRIBUTED_TO
  for (const f of facts.CONTRIBUTED_TO ?? []) {
    const rId = repositoryId(f.repository.fullName);
    if (!kg.entities.repositories.find((r) => r.id === rId)) continue;
    addEdgeWithAttrConflict(
      kg,
      "CONTRIBUTED_TO",
      personIdValue,
      rId,
      "",
      f.source,
      (f.attrs ?? {}) as Record<string, unknown>,
    );
  }

  // HAS_SKILL
  for (const f of facts.HAS_SKILL ?? []) {
    const sId = skillId(f.skill.canonicalName);
    if (!kg.entities.skills.find((s) => s.id === sId)) continue;
    addEdgeWithAttrConflict(
      kg,
      "HAS_SKILL",
      personIdValue,
      sId,
      "",
      f.source,
      (f.attrs ?? {}) as Record<string, unknown>,
    );
  }

  // AUTHORED
  for (const f of facts.AUTHORED ?? []) {
    const pId = publicationId({ url: f.publication.url, title: f.publication.title, doi: f.publication.doi });
    if (!kg.entities.publications.find((p) => p.id === pId)) continue;
    addEdgeWithAttrConflict(
      kg,
      "AUTHORED",
      personIdValue,
      pId,
      "",
      f.source,
      (f.attrs ?? {}) as Record<string, unknown>,
    );
  }

  // OPERATES
  for (const f of facts.OPERATES ?? []) {
    const cId = companyId({ name: f.company.canonicalName, domain: f.company.domain });
    if (!kg.entities.companies.find((c) => c.id === cId)) continue;
    addEdgeWithAttrConflict(
      kg,
      "OPERATES",
      personIdValue,
      cId,
      "",
      f.source,
      (f.attrs ?? {}) as Record<string, unknown>,
    );
  }

  // WON
  for (const f of facts.WON ?? []) {
    const aId = achievementId({ title: f.achievement.title, date: f.achievement.date });
    if (!kg.entities.achievements.find((a) => a.id === aId)) continue;
    addEdgeWithAttrConflict(
      kg,
      "WON",
      personIdValue,
      aId,
      "",
      f.source,
      (f.attrs ?? {}) as Record<string, unknown>,
    );
  }

  // ATTENDED
  for (const f of facts.ATTENDED ?? []) {
    const eId = eventId({ name: f.event.name, date: f.event.date });
    if (!kg.entities.events.find((e) => e.id === eId)) continue;
    addEdgeWithAttrConflict(
      kg,
      "ATTENDED",
      personIdValue,
      eId,
      "",
      f.source,
      {} as Record<string, unknown>,
    );
  }

  // LIVES_IN — represented on the Person node directly; emit a single edge per location for evidence.
  for (const f of facts.LIVES_IN ?? []) {
    const cityId = `loc:${slug(f.location)}`;
    addEdgeWithAttrConflict(
      kg,
      "LIVES_IN",
      personIdValue,
      cityId,
      "",
      f.source,
      { location: f.location } as Record<string, unknown>,
    );
  }
}

/**
 * Add an edge with conflict resolution: if the edge already exists with a
 * different attr value, keep the value from the higher-priority source.
 * Always append the source to `sources[]`.
 */
function addEdgeWithAttrConflict(
  kg: KnowledgeGraph,
  type: EdgeType,
  from: string,
  to: string,
  suffix: string,
  source: Source,
  attrs: Record<string, unknown>,
): void {
  const id = edgeId({ type, from, to, suffix });
  let edge = kg.edges.find((e) => e.id === id);
  if (!edge) {
    edge = {
      id,
      type,
      from,
      to,
      attrs: { ...attrs },
      sources: [source],
      band: deriveBand([source]),
    };
    kg.edges.push(edge);
    return;
  }
  edge.sources.push(source);
  edge.band = deriveBand(edge.sources);
  // Resolve conflicting attrs by source priority: highest-priority value wins.
  const top = pickHighestPrioritySource(edge.sources);
  if (top && top.t === source.t && top.fetcher === source.fetcher) {
    // Newly added source is highest priority — overwrite display attrs.
    for (const [k, v] of Object.entries(attrs)) {
      if (v !== undefined && v !== null && v !== "") edge.attrs[k] = v;
    }
  } else {
    // Merge non-conflicting attrs only.
    for (const [k, v] of Object.entries(attrs)) {
      if (edge.attrs[k] == null && v != null && v !== "") edge.attrs[k] = v;
    }
  }
}

// Re-export some types tests / call-sites need.
export type {
  KnowledgeGraph,
  Person,
  Company,
  School,
  Project,
  Repository,
  Skill,
  Publication,
  Achievement,
  KGEvent as Event,
  Edge,
  Role,
  Source,
};
