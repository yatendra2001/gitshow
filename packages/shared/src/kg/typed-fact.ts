/**
 * TypedFact — the contract every fetcher emits.
 *
 * A fact is a tuple of (Entity, Edge, Source). Fetchers don't merge; they
 * just emit. The merger (apps/worker/src/resume/kg/merger.ts) fuses facts
 * from many fetchers into the KG.
 *
 * The discriminator is `kind` (= Edge type). The shape is intentionally
 * flat — easier to log, easier to reason about.
 */

import type {
  Achievement,
  AchievementKind,
  Company,
  Event as KGEvent,
  EventKind,
  Person,
  Polish,
  Project,
  ProjectKind,
  Publication,
  PublicationKind,
  Repository,
  Role,
  School,
  Skill,
  Source,
} from "./schema.js";

// Each fact carries optional entity hints — the merger uses them to
// upsert nodes before linking edges. Hints are partial; only the
// minimum the fetcher knows.

export interface FactBase {
  source: Source;
}

export interface PersonFact extends FactBase {
  kind: "PERSON";
  /** Patches the Person node (name, bio, location, avatar, url, email). */
  person: Partial<Omit<Person, "id" | "handle" | "discoverable">>;
}

export interface WorkedAtFact extends FactBase {
  kind: "WORKED_AT";
  company: Pick<Company, "canonicalName"> & Partial<Omit<Company, "id">>;
  role?: Partial<Omit<Role, "id" | "normalizedTitle">>;
  attrs: {
    /** Human-readable role/title shown on the resume card. */
    role: string;
    start?: string;
    end?: string;
    present?: boolean;
    location?: string;
    description?: string;
    employmentType?: string; // "full-time" | "internship" | "contract" | "part-time" | "advisor" | "founder"
  };
}

export interface StudiedAtFact extends FactBase {
  kind: "STUDIED_AT";
  school: Pick<School, "canonicalName"> & Partial<Omit<School, "id">>;
  attrs: {
    degree: string;
    start?: string;
    end?: string;
    field?: string;
    location?: string;
  };
}

export interface BuiltFact extends FactBase {
  kind: "BUILT";
  project: Pick<Project, "title"> &
    Partial<Omit<Project, "id" | "shouldFeature">>;
  attrs: {
    role?: string;
    start?: string;
    end?: string;
    active?: boolean;
  };
}

export interface ContributedToFact extends FactBase {
  kind: "CONTRIBUTED_TO";
  repository: Pick<Repository, "fullName"> & Partial<Omit<Repository, "id">>;
  attrs: {
    commits?: number;
    mergedPRs?: number;
    relationship?: "owner" | "collaborator" | "contributor" | "reviewer";
  };
}

export interface LivesInFact extends FactBase {
  kind: "LIVES_IN";
  /** Free-form location string ("San Francisco, CA"). */
  location: string;
}

export interface HasSkillFact extends FactBase {
  kind: "HAS_SKILL";
  skill: Pick<Skill, "canonicalName"> & Partial<Omit<Skill, "id">>;
  attrs: {
    weight?: number;
  };
}

export interface WonFact extends FactBase {
  kind: "WON";
  achievement: Pick<Achievement, "title" | "kind"> & Partial<Omit<Achievement, "id">>;
  event?: Partial<Omit<KGEvent, "id">>;
  attrs: {
    rank?: string; // "1st place", "Best UX", etc.
  };
}

export interface CoBuiltWithFact extends FactBase {
  kind: "CO_BUILT_WITH";
  project: Pick<Project, "title"> & Partial<Omit<Project, "id">>;
  collaboratorHandle: string;
}

export interface AuthoredFact extends FactBase {
  kind: "AUTHORED";
  publication: Pick<Publication, "title" | "url" | "kind"> &
    Partial<Omit<Publication, "id">>;
  attrs?: {
    role?: "author" | "co-author" | "reviewer" | "editor";
  };
}

export interface OperatesFact extends FactBase {
  kind: "OPERATES";
  company: Pick<Company, "canonicalName"> & Partial<Omit<Company, "id">>;
  attrs?: {
    role?: string;
  };
}

export interface AttendedFact extends FactBase {
  kind: "ATTENDED";
  event: Pick<KGEvent, "name" | "kind"> & Partial<Omit<KGEvent, "id">>;
}

export type TypedFact =
  | PersonFact
  | WorkedAtFact
  | StudiedAtFact
  | BuiltFact
  | ContributedToFact
  | LivesInFact
  | HasSkillFact
  | WonFact
  | CoBuiltWithFact
  | AuthoredFact
  | OperatesFact
  | AttendedFact;

export type TypedFactKind = TypedFact["kind"];

// ─── Tiny typed emitter helper for fetchers ──────────────────────────

/**
 * Build a Source struct with sensible defaults. Fetchers usually only
 * vary `confidence`, `url`, and `snippet`.
 */
export function makeSource(input: {
  fetcher: Source["fetcher"];
  method?: Source["method"];
  confidence: Source["confidence"];
  url?: string;
  snippet?: string;
  authority?: "first-party-api";
  t?: number;
}): Source {
  return {
    fetcher: input.fetcher,
    method: input.method ?? "scrape",
    confidence: input.confidence,
    url: input.url,
    snippet: input.snippet ? input.snippet.slice(0, 540) : undefined,
    authority: input.authority,
    t: input.t ?? Date.now(),
  };
}

// Re-export commonly-needed value enums for fetcher imports.
export type { ProjectKind, Polish, PublicationKind, AchievementKind, EventKind };
