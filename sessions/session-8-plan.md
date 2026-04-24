# Session 8 — Plan: Knowledge Graph pipeline + LinkedIn scrape chain

**Scope**: one big PR that replaces the current extraction pipeline with a Knowledge-Graph-backed architecture, upgrades LinkedIn to a 4-tier scrape chain (TinyFish → Jina → Playwright/Googlebot → PDF upload), and adds the media-download stage. Designed to be executable in a fresh session without re-litigating design decisions.

**Base**: `main` at `665ee1f` (post-PR #94 — observability trace already persists to R2).

**Delete-on-merge branch name**: `feat/kg-pipeline` (one branch, one PR, merged atomically).

**Authoritative one-liner of the change**: *Resume JSON becomes a deterministic projection of a per-user Knowledge Graph. LinkedIn becomes a 4-tier scrape chain. Repos are judged by reading their code, not matching metadata strings.*

---

## 1. Why this is one big PR

The sections are tightly coupled:

- The KG has a Repo Judge stage that replaces `pick-featured.ts`. That cascade rewires `projects`, `buildLog`, and the evaluator.
- The LinkedIn 4-tier scrape chain changes what the KG's `linkedin` fetchers emit (typed facts per tier), which changes the confidence math in the merger.
- The render layer reads from the KG — so every current section agent (`work`, `education`, `skills`, `projects`, `person`) changes at once or not at all.

Splitting it means 3-4 intermediate broken states on `main`. Keeping it atomic is cleaner even though the PR is ~20 files.

A merge-ready checkpoint list lives at the bottom under **Definition of done**.

---

## 2. Who this serves + what we're fixing

### 2.1 Personas this pipeline must serve

The plan is stress-tested against six distinct profile shapes. Every design decision gets checked: does this work for each?


| #   | Persona                               | Primary signal                                                 | How this PR serves them                                                                                  |
| --- | ------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1   | **Solo indie builder**                | GitHub repos, low stars, long tail of shipped projects         | Repo Judge reads code → featured is real projects only; personal-site fetcher carries the narrative      |
| 2   | **Corporate engineer**                | LinkedIn-heavy, sparse public GitHub, most work in private org | LinkedIn 4-tier scrape chain (TinyFish → Jina → Playwright/Googlebot → PDF upload) fills the gap         |
| 3   | **OSS maintainer**                    | High-star public repos, drive-by PRs to huge codebases         | Entity-typed `CONTRIBUTED_TO` edges (not `WORKED_AT`) for drive-bys; star-weighted ranking in featured   |
| 4   | **Student / new grad**                | Many coursework repos, few real projects, thin LinkedIn        | Judge classifies coursework as non-featured; hackathons get their own section; personal site as fallback |
| 5   | **Career-switcher / non-traditional** | Bootcamp + self-study, unusual employment trail                | Dev.to / Medium / personal-site fetchers carry the narrative; LinkedIn PDF upload as supplement          |
| 6   | **Researcher / academic**             | Papers, ORCID, arxiv, Semantic Scholar, conference talks       | ORCID + Semantic Scholar + arxiv fetchers emit `Publication` nodes; dedicated Publications section       |


All six personas are served directly by this PR. The "designer / creator" persona (Dribbble, Behance, YouTube as primary signal) is explicitly deferred to a later PR — see §19.1. The KG architecture accommodates its additions when it lands.

### 2.2 Classes of failure this PR fixes

Ground truth comes from production scan `scan-xtt7yzBSWY` (trace at `r2://debug/scan-xtt7yzBSWY/trace.json`) plus hypothetical cases drawn from the personas above. Each numbered failure below is a **general class**; the italicised example is the specific instance we have receipts for.

1. **Roles mislabeled as formal employment when they're really OSS contributions** — the Work section conflates "employed at X" with "contributed to X". Work entries end up without dates because LinkedIn doesn't carry per-contribution dates.
  *Seen: AppFlowy / Welltested AI / Rocket.Chat shown as jobs with no start/end.*
   *Also hits: persona 3 (OSS maintainers) systematically; persona 2 (corporate engineers with side OSS contributions).*
2. **Evidence fragmented across sources fails to fuse into one entity** — person is described two different ways in two different places, pipeline treats them as separate (or drops both).
  *Seen: personal site says "video-first podcast hosting platform", LinkedIn snippet says "currently at flightcast" — the agent couldn't link them.*
   *Also hits: persona 5 (career-switchers with multiple narratives), persona 4 (students whose school name varies by source).*
3. **Long-but-empty fetched content passes "is this usable" heuristics** — length-based `isUsable` lets login-wall bloat through even when no Experience/Education is actually present.
  *Seen: LinkedIn returned 13K chars of chrome text; Education section came back `[]`.*
   *Also hits: any persona whose LinkedIn is login-walled to the scraper.*
4. **Trivial, noise, or auto-generated repos rank into featured projects** — regex noise-filters match on public metadata but repos are often private or undescribed, so the filter sees nothing to reject.
  *Seen: `Import_BitBucket_Repo` (private, no public description, 227 auto-generated commits) ranked #2 in featured.*
   *Also hits: persona 1 (dotfiles, sandbox repos), persona 4 (tutorial-follow repos, coursework clones), persona 3 (forks the user never customized).*
5. **Downstream sections populated in data but broken in render** — data layer has the content but the route/navigation doesn't expose it correctly.
  *Seen: blog entries populated in Resume JSON but `/handle/blog` route "not working".*
   *Also hits: persona 6 (Publication data would render nowhere without a route), persona 7 (image assets would load nowhere without the media pipeline).*

The KG + Repo Judge + LinkedIn scrape chain + Media fetch architecture fixes all five classes of failure for all six personas in scope (persona 7 is §19.1 deferral).

---

## 3. Architecture overview

### 3.1 Data flow

```
┌─ FETCHERS (parallel) ────────────────────────────────────────────┐
│   github / inventory                                              │
│   linkedin-public (Tier 1+2: TinyFish, Jina)                      │
│   linkedin-playwright (Tier 3: Googlebot UA scrape)               │
│   linkedin-pdf (Tier 4: user-uploaded export)                     │
│   personal-site                                                   │
│   twitter-bio                                                     │
│   hn-profile / devto-profile / medium-profile                     │
│   blog-import                                                     │
│   dev-evidence (orchestrator+workers, already exists)             │
│   intake (existing)                                               │
└────────────┬──────────────────────────────────────────────────────┘
             │ emits typed facts (TypedFact<E>)
┌────────────▼──────────────────────────────────────────────────────┐
│  REPO JUDGE                                                       │
│   For each cloned repo: Kimi reads README + tree + top files     │
│   Emits Project + BUILT + Judgment edge                          │
└────────────┬──────────────────────────────────────────────────────┘
             │
┌────────────▼──────────────────────────────────────────────────────┐
│  KG MERGER                                                        │
│   1. Deterministic: exact name / slug / domain match              │
│   2. Opus pass: ambiguous entity pairs                            │
│   3. Confidence band per edge                                     │
│   4. Conflict resolution by source priority                       │
└────────────┬──────────────────────────────────────────────────────┘
             │
┌────────────▼──────────────────────────────────────────────────────┐
│  MEDIA FETCH (parallel)                                           │
│   Per Project: OG image / README image / YouTube thumb → R2      │
│   Per Company/School: Clearbit logo → R2                         │
└────────────┬──────────────────────────────────────────────────────┘
             │
┌────────────▼──────────────────────────────────────────────────────┐
│  KG EVALUATOR (not Resume evaluator)                              │
│   Blocking: 0 Person; featured contains judge.kind=mirror         │
│   Warning: LinkedIn connected but 0 WORKED_AT; Opus retries once  │
└────────────┬──────────────────────────────────────────────────────┘
             │
┌────────────▼──────────────────────────────────────────────────────┐
│  RENDER (deterministic + 1 Opus call for hero prose)              │
│   Resume JSON = SELECT * FROM KG with section-specific filters    │
└────────────┬──────────────────────────────────────────────────────┘
             │
┌────────────▼──────────────────────────────────────────────────────┐
│  PERSIST                                                          │
│   kg/{handle}/latest.json    — source of truth                    │
│   kg/{handle}/scan-{id}.json — immutable snapshot                 │
│   resumes/{handle}/draft.json — projection (unchanged path)       │
│   debug/{scanId}/trace.json  — observability (unchanged)          │
│   media/{handle}/...         — downloaded assets                  │
└───────────────────────────────────────────────────────────────────┘
```

### 3.2 KG schema

File: `packages/shared/src/kg/schema.ts` (new).

```ts
// Nodes
interface Person        { id: string; handle: string; name?: string; bio?: string; location?: string; avatarUrl?: string; initials?: string; discoverable: boolean; }
interface Company       { id: string; canonicalName: string; domain?: string; aliases: string[]; }
interface School        { id: string; canonicalName: string; domain?: string; aliases: string[]; }
interface Role          { id: string; title: string; normalizedTitle: string; }
interface Project       { id: string; title: string; purpose: string; kind: ProjectKind; polish: Polish; shouldFeature: boolean; reason: string; dates?: { start?: string; end?: string; active?: boolean }; tags: string[]; }
interface Repository    { id: string; fullName: string; primaryLanguage?: string; isPrivate: boolean; stars: number; pushedAt?: string; }
interface Skill         { id: string; canonicalName: string; category?: string; iconKey?: string; }
interface Publication   { id: string; title: string; platform: string; publishedAt?: string; url: string; body?: string; kind: PublicationKind; venue?: string; doi?: string; coAuthors?: string[]; }
interface Achievement   { id: string; title: string; kind: AchievementKind; date?: string; repUnit?: number; }
interface Event         { id: string; name: string; kind: "conference" | "hackathon" | "talk" | "podcast"; date?: string; }
interface MediaAsset    { id: string; kind: "hero" | "thumbnail" | "screenshot" | "logo"; r2Key?: string; remoteUrl?: string; width?: number; height?: number; }

// Edges — every edge carries the shared provenance block
type Source = {
  fetcher: "github" | "linkedin-public" | "linkedin-playwright" | "linkedin-pdf" | "personal-site" | "twitter" | "hn" | "devto" | "medium" | "orcid" | "semantic-scholar" | "arxiv" | "stackoverflow" | "evidence-search" | "repo-judge" | "intake";
  url?: string;
  snippet?: string;          // verbatim ~280 chars
  method: "api" | "scrape" | "llm-extraction" | "user-input";
  confidence: "high" | "medium" | "low";
  authority?: "first-party-api"; // reserved: ORCID API, future LinkedIn portability API
  t: number;
};

interface Edge {
  id: string;
  type: "WORKED_AT" | "STUDIED_AT" | "BUILT" | "CONTRIBUTED_TO" | "LIVES_IN" | "HAS_SKILL" | "WON" | "CO_BUILT_WITH" | "AUTHORED" | "OPERATES" | "HAS_JUDGMENT" | "HAS_MEDIA";
  from: string;              // entity id
  to: string;                // entity id
  attrs: Record<string, unknown>; // type-specific: {role, start, end, present} for WORKED_AT, etc.
  sources: Source[];
  band: "verified" | "likely" | "suggested"; // derived from sources
}

interface KnowledgeGraph {
  schemaVersion: 1;
  meta: { scanId: string; handle: string; model: string; startedAt: number; finishedAt: number; };
  entities: {
    persons: Person[];
    companies: Company[];
    schools: School[];
    roles: Role[];
    projects: Project[];
    repositories: Repository[];
    skills: Skill[];
    publications: Publication[];
    achievements: Achievement[];
    events: Event[];
  };
  edges: Edge[];
  resolved: { pairs: Array<{ a: string; b: string; decision: "merge" | "separate"; rationale: string }>; };
  warnings: string[];
}

// Derived enums
type ProjectKind = "product" | "library" | "tool" | "experiment" | "tutorial-follow" | "template-clone" | "fork-contribution" | "contribution-mirror" | "dotfiles-config" | "coursework" | "empty-or-trivial" | "research-artifact";
type Polish = "shipped" | "working" | "wip" | "broken" | "not-code";
type PublicationKind = "blog" | "paper" | "preprint" | "talk" | "podcast" | "other";
type AchievementKind = "hackathon" | "award" | "feature" | "press" | "rep-milestone" | "certification" | "other";
```

### 3.3 Confidence derivation

```ts
// Per edge:
score = count(high-sources) + 0.5 * count(medium-sources);
if (any source.authority === "first-party-api") score += 2; // e.g., ORCID API response
band = score >= 2 ? "verified" : score >= 1 ? "likely" : "suggested";
```

### 3.4 Entity ID convention

Deterministic, stable across scans:

- Person: `person:{handle}`
- Company: `co:{slug(canonicalName)}` or `co:{domain}` if known
- School: `sc:{slug(canonicalName)}` or `sc:{domain}`
- Project: `proj:{repoFullName}` or `proj:{slug(title)}` if no repo
- Repository: `repo:{fullName}`
- Skill: `skill:{slug(canonicalName)}`
- Role: `role:{company.id}:{slug(title)}`

Stable IDs enable cross-scan diffing (future) and referential integrity.

---

## 4. LinkedIn integration detail

### 4.1 Philosophy

**No OAuth, no app submission, no approval wait.** Scraping is a legitimate product decision here — we operate on the user's own profile URL, which they provide. The simple tiered chain is honest about what it is and leaves the gnarly legitimacy work (Member Data Portability, partner status) for the future if/when we outgrow scraping. Four tiers, tried in order, first-usable wins:


| Tier | Method                        | Input               | Works best on                                                                                                                             |
| ---- | ----------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | **TinyFish fetch**            | user's LinkedIn URL | rare wins on search-engine-cached profiles; skipped for `linkedin.com/in/`* since we've observed it always returning 145-char login walls |
| 2    | **Jina Reader**               | user's LinkedIn URL | ~30% of public profiles                                                                                                                   |
| 3    | **Playwright + Googlebot UA** | user's LinkedIn URL | ~70% of public profiles; the most reliable tier                                                                                           |
| 4    | **PDF upload**                | user file upload    | 100% (when user uploads)                                                                                                                  |


Fetchers are run sequentially — as soon as one returns usable typed facts (at least one of Experience / Education / Skills section parsed), we stop and emit those facts. The evaluator still flags if ALL fail and no PDF was uploaded, and surfaces a UI prompt.

### 4.2 Tier 1 — TinyFish (existing)

Kept as-is from the current `linkedin-public.ts` logic: skip for `linkedin.com/in/`* URLs (empirically returns login walls; saves a credit), but useful for personal-site pages the user uses to link to their LinkedIn.

### 4.3 Tier 2 — Jina Reader (existing)

The current public-scrape path. `https://r.jina.ai/{linkedinUrl}` returns markdown. Kept as-is — already emits typed facts via refactored `linkedin-public.ts`.

### 4.4 Tier 3 — Playwright with Googlebot UA (NEW)

The interesting addition. LinkedIn serves a more complete version of public profiles to search-engine crawlers for SEO — including Experience and Education sections in structured form. We replicate a Googlebot fetch on Fly.

**File**: `apps/worker/src/resume/fetchers/linkedin-playwright.ts`

**Strategy**:

1. Launch headless Chromium on Fly worker via `playwright` (already Linux-compatible; Fly VMs are full OS).
2. Set `User-Agent: Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)` and `X-Robots-Tag` headers.
3. Navigate to the LinkedIn URL with a 20s timeout.
4. Wait for `.pv-top-card` or `[data-section="experience"]` — indicators that actual profile content rendered (not a wall).
5. If login-wall indicators (`"Sign Up | LinkedIn"` title, `/authwall` URL) detected → return null so caller tries PDF upload.
6. Otherwise, extract structured HTML → parse Experience / Education / Skills sections → emit typed facts.
7. On any error (timeout, navigation failure, detected wall) → return null, non-fatal.

**Infrastructure**:

Concrete `apps/worker/Dockerfile` additions (append to existing, before the `CMD` line):

```dockerfile
# --- Playwright + Chromium for LinkedIn tier-3 fetch (§4.4) ---
# Install only chromium (not all browsers) to keep image size down.
# `--with-deps` pulls in the system libs Chromium needs (libnss3, libasound2, etc.)
# which Debian slim images don't ship by default.
RUN bunx playwright install --with-deps chromium

# Required by `sharp` (native image resize for §8 media pipeline).
# libvips is the runtime; the package's install script pulls it in
# but on the slim base we need the apt packages explicitly.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libvips42 \
    && rm -rf /var/lib/apt/lists/*

# Env vars used at runtime — none required; Playwright finds the
# browser via its install path by default.
```

`apps/worker/package.json` deps to add (alongside existing):
```json
"playwright": "^1.48.0",
"sharp": "^0.33.0"
```

Image size delta: ~180-220 MB total (Chromium ~150 MB + libvips + pdf-parse + fast-xml-parser). See §10.5 for ops implications.

**Observability**:

- Trace event `linkedin.playwright.fetch` with outcome (`walled` / `usable` / `error`), response time, detected sections count.
- On repeated walls from the same Fly IP over multiple scans, the trace will make this visible and we can consider a residential proxy (future optimization, not in this PR).

**Anti-bot honesty**: LinkedIn's anti-bot team rotates detection. Googlebot UA works today; may stop. When it stops, the tier drops gracefully to PDF. This is acceptable — we're not building a scraping business, we're adding a best-effort tier to an already-graceful fallback chain.

**Porting notes**: we're not literally porting a specific TypeScript library — no mature no-login LinkedIn scraper exists in the TS ecosystem. We're implementing the Playwright-with-crawler-UA pattern ourselves (~150 lines of code). The approach is documented across multiple open-source Python scrapers + SEO blog posts; this is standard "public-web fetch with crawler headers".

### 4.5 Tier 4 — PDF upload (existing scaffold, needs UI)

When all three scrape tiers return null, the UI surfaces: *"We couldn't auto-read your LinkedIn. Upload your profile PDF (Me → Save to PDF on LinkedIn) — it's the most complete source."*

Implementation:

- `apps/web/app/api/scan/upload-linkedin-pdf/route.ts` — POST endpoint, accepts file upload, parses with `pdf-parse`, writes the text into `scan.context_notes` tagged as `#linkedin-pdf`.
- Worker's `linkedin-pdf.ts` fetcher splits on that tag, runs a small Kimi extraction, emits typed facts with `confidence: high` (user-verified).

### 4.6 Intake surface

Intake form keeps its existing "LinkedIn URL" field (optional). No OAuth prompt, no "Connect LinkedIn" CTA — just:

> *LinkedIn URL (optional). If auto-scraping fails, we'll offer a PDF upload fallback.*

Simpler UX. Nothing to link, nothing to consent to beyond the scan itself.

### 4.7 Privacy + terms (still land in this PR, but lower stakes)

Two pages — `apps/web/app/privacy/page.tsx`, `apps/web/app/terms/page.tsx` — still needed for basic product hygiene, but no longer gated on LinkedIn app submission. Content describes:

- What we scan, where we store it, how long
- That we scrape LinkedIn public pages (we're explicit about this)
- Account deletion endpoint
- Contact email

First draft in the PR; legal review later if we want it.

### 4.8 What we're NOT doing (explicit)

- No "Sign in with LinkedIn" OAuth flow
- No LinkedIn Developer Portal app
- No Data Portability scope submission (keep as escape-hatch if scraping ever fully breaks; not a current dependency)
- No session-cookie paste (PDF upload covers this at zero user-account risk)

---

## 5. Repo Judge detail

Replaces `apps/worker/src/resume/pick-featured.ts` as the gatekeeper. Reads actual code.

### 5.1 Interface

```ts
// apps/worker/src/resume/judge/repo-judge.ts (new)
export interface RepoJudgeInput {
  session: ScanSession;
  usage: SessionUsage;
  repo: RepoRef;
  /** Local path where the repo was cloned (inventory stage). */
  repoPath: string;
  trace?: ScanTrace;
}

export interface RepoJudgment {
  kind: ProjectKind;
  authorship: "primary" | "co-author" | "contributor" | "templated-from-other";
  effort: "substantial" | "moderate" | "light" | "none";
  polish: Polish;
  purpose: string;      // one-sentence honest description
  shouldFeature: boolean;
  reason: string;       // why featured / not
  technologies: string[]; // parsed from manifests + detected frameworks
}
```

### 5.2 What the Judge reads

From the local clone at `repoPath`:

- `README.md` (or `README`, `README.txt`) — first 3KB
- File tree (top-level, depth 2) — formatted as text
- Up to 5 largest source files (by bytes, filtering out `node_modules`, `.git`, `dist`, etc.) — first 2KB each
- Manifests (parse first, feed as structured): `package.json`, `pubspec.yaml`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `Gemfile`, `requirements.txt`

Bounded: total prompt input capped at ~20KB.

### 5.3 Model choice

`bulk` tier (Kimi K2.6) via `modelForRole("bulk")`. Judgment is a classification task on bounded text — no need for orchestrator-tier.

### 5.4 Parallel scheduling

- Input: top-N featured candidates from a cheap deterministic pre-score (stars + user-commits, NO regex noise filter). Default N = 30.
- Concurrency: `pLimit(5)` — balance between wall-clock and OpenRouter session ceiling.
- Wall-clock budget: ~60s at worst.
- Cost budget: ~30 × $0.002 ≈ **$0.06/scan**.

### 5.5 System prompt (draft)

Needs to be tight. Keys:

- Ask for the JSON shape of RepoJudgment as a submit tool
- Tell Kimi the ONLY test for `shouldFeature=true` is "did the user build something real and worth showing?"
- Hard bans: never mark `contribution-mirror / dotfiles-config / empty-or-trivial` as shouldFeature=true
- External validation (stars, forks, mentions) is NEVER a gate — those live in ranking, not qualification
- Judge reads the code; if code says "auto-generated mock", kind = "contribution-mirror"

Full prompt goes in the source file — don't inline here.

### 5.6 Replaces

- `apps/worker/src/resume/pick-featured.ts` is DELETED
- `isNoiseRepo` / regex patterns removed entirely
- `pickFeatured(github, artifacts)` replaced with projection over KG: `selectFeatured(kg)` that filters by Judge output

---

## 6. New fetchers detail

Each lives at `apps/worker/src/resume/fetchers/*.ts` and exports a single function returning `TypedFact[]`. File-per-fetcher for clean isolation + trace labelling.

### 6.1 `linkedin-public.ts` (Tier 1 + Tier 2 chain)

- Tier 1: TinyFish fetch on non-`/in/` LinkedIn URLs (personal-site links to LinkedIn, company pages, etc.). Skip on `linkedin.com/in/`* since it always login-walls (observed).
- Tier 2: Jina Reader on the LinkedIn URL. `https://r.jina.ai/{url}` → markdown. Existing logic (`isUsable` wall detection, title checks).
- Emits typed facts (`WORKED_AT`, `STUDIED_AT`, `HAS_SKILL`) via a small Kimi extraction pass on the markdown.
- Confidence: `medium` (anonymous public scrape).
- Returns null if both tiers fail → caller falls through to Tier 3 (Playwright).

### 6.2 `linkedin-playwright.ts` (Tier 3, NEW)

Details spec'd in §4.4. Short version:

- Launch headless Chromium via Playwright, set Googlebot UA headers.
- Navigate to LinkedIn URL; detect content vs. wall.
- Parse Experience / Education / Skills sections from structured HTML.
- Emit typed facts with `confidence: medium` (still scrape, but structurally richer than Jina).
- Returns null on wall-detection or error; caller falls through to Tier 4 (PDF).

### 6.3 `linkedin-pdf.ts` (Tier 4)

- Reads `CONTEXT_NOTES` for a `#linkedin-pdf\n...\n#end` block (web worker extracts + embeds pre-scan).
- Parses via a tiny Opus call: "Convert this LinkedIn PDF text into typed JSON (positions, educations, skills)."
- Confidence: `high` (user-provided, authoritative like intake).
- Web side: new `/api/scan/upload-linkedin-pdf` endpoint that uses `pdf-parse` to extract text server-side, sets on the scan row.

### 6.4 `personal-site.ts`

- Input: `session.socials.website`.
- TinyFish fetch on the URL.
- Kimi extraction: "What do we learn about this person? Return typed facts."
- Emits: `WORKED_AT` (e.g., `Founding Engineer at video-first podcast platform`), `BUILT` (projects listed), bio line.
- Important: keeps prose from the site as candidate hero-paragraph material (feeds person agent).

### 6.5 `twitter-bio.ts`

- Input: `session.socials.twitter`.
- TinyFish fetch `https://twitter.com/{handle}` — bio is usually in the page even for logged-out viewers.
- Kimi extraction of bio line + pinned tweet.
- Emits: `WORKED_AT{present: true}` when bio says "currently at X" / "building X". Confidence `medium`.

### 6.6 `hn-profile.ts`, `devto-profile.ts`, `medium-profile.ts`

- URL guessing: use session handle + common patterns (`dev.to/{handle}`, `medium.com/@{handle}`, `news.ycombinator.com/user?id={handle}`).
- 404 = skip silently.
- Kimi extraction of bio + "about" section.
- Emits: `WORKED_AT` claims (often self-reported), `AUTHORED` for post links.

### 6.7 `orcid.ts` (researcher persona)

- Input: user-provided ORCID iD via intake (`https://orcid.org/0000-0000-0000-0000`) OR guessed from Semantic Scholar match.
- Calls ORCID public API: `https://pub.orcid.org/v3.0/{orcid-id}/record` (no auth needed for public records, JSON).
- Parses: `works[]` → `Publication` nodes, `employments[]` → `WORKED_AT` edges, `educations[]` → `STUDIED_AT`.
- Confidence: `high` (first-party authenticated-by-ORCID data, though not from an OAuth flow).
- Emits: `Publication`, `WORKED_AT`, `STUDIED_AT`, `HAS_SKILL` (from keywords).
- Rate limit: generous; 24 req/sec public tier.

### 6.8 `semantic-scholar.ts` (researcher persona)

- Input: person's full name + optional affiliation string (from GitHub bio / personal site).
- Calls Semantic Scholar API: `GET /graph/v1/author/search?query={name}` → picks top match.
- Then `GET /graph/v1/author/{id}/papers?limit=50` for the publication list.
- No API key needed for public data; rate-limited to ~100 req/5min.
- Emits: `Publication` nodes (title, venue, year, DOI), `AUTHORED` edges.
- Disambiguation: when multiple authors match, the merger's Opus pair-resolution pass decides which is our user.

### 6.9 `arxiv.ts` (researcher persona)

- Input: person's full name.
- arxiv Search API: `http://export.arxiv.org/api/query?search_query=au:"Name Surname"&max_results=50` (XML response).
- Emits: `Publication` nodes with arxiv IDs, links back to full PDFs.
- Deduped against Semantic Scholar results during merger (same paper shows up in both).
- No auth, no quota.

### 6.10 `stackoverflow.ts` (any persona with Q&A rep)

- Input: `session.socials.stackoverflow` (stackoverflow.com user URL) OR guessed from handle.
- Stack Exchange API: `/users/{id}?site=stackoverflow` + `/users/{id}/top-tags` (no auth for read-only data).
- Emits: `HAS_SKILL` edges weighted by top-tags reputation, `Achievement{kind: "rep-milestone"}` if rep > 10k.
- Useful cross-persona signal — developers with high Stack Overflow reputation want it credited in the portfolio.

### 6.11 Existing fetchers (refactor to emit typed facts)

- `github-fetcher.ts` — emits `Repository`, `Person-CONTRIBUTED_TO-Repository`. Also `WORKED_AT` HINT candidates from commit-email domains.
- `dev-evidence.ts` — cards become sources attached to EXISTING entities during merger, not standalone nodes.
- `intake` — already high-trust. Wire its typed output into the KG merger. **Intake form extended** to ask for ORCID, Stack Overflow URLs (both optional, in addition to existing LinkedIn / personal-site / Twitter / blog URLs).
- `blog-import.ts` — emits `Publication` nodes. Unchanged otherwise.

---

## 7. Merger detail

File: `apps/worker/src/resume/kg/merger.ts` (new).

### 7.1 Flow

```ts
export async function mergeFactsIntoKG(
  facts: TypedFact[],
  opts: { session, usage, trace? }
): Promise<KnowledgeGraph>
```

1. **Bucket by entity type.** Collect all Company candidates across fetchers, all School candidates, etc.
2. **Deterministic merge within each bucket:**
  - Exact canonical-name match (lowercased)
  - Exact slug match (lowercased + alphanumeric only)
  - Domain match (when both have `domain` attribute)
3. **Build LLM pair list.** Pairs the deterministic pass couldn't decide:
  - `Company{name:"Flightcast"}` + `Company{name:"video-first podcast hosting platform"}` — different names, no domain overlap, but from same person's sources.
  - Cap at 20 pairs (safety — if we're seeing more ambiguity than that, extraction is too loose upstream).
4. **ONE Opus call** for the pair resolution. Input: pairs + their source snippets. Output: `{merge | separate | unclear, rationale}` per pair. The rationale becomes a source on the merged entity.
5. **Build edges** from typed facts with deduped entity IDs.
6. **Confidence band** per edge using the formula in §3.3.
7. **Conflict resolution** on edge attributes (e.g., same WORKED_AT but different dates):
  - Priority: `intake > linkedin-pdf > personal-site > linkedin-playwright > linkedin-public > orcid > semantic-scholar > evidence-search > github-hint`
  - Display value from highest-priority source; keep all as `sources[]`.

### 7.2 Output

Full `KnowledgeGraph` shape from §3.2. Persisted to R2 in the persist stage.

---

## 8. Media fetch detail

File: `apps/worker/src/resume/media/media-fetch.ts` (new).

### 8.1 Flow

```ts
export async function fetchMediaForKG(
  kg: KnowledgeGraph,
  opts: { session, trace? }
): Promise<KnowledgeGraph /* with HAS_MEDIA edges */>
```

For each `Project` node (tiered, first success wins):

1. If `Repository` has homepage URL → TinyFish fetch, parse `<meta property="og:image">`, download the image.
2. Else if README has `<img src>` links → download top 3 that look like hero images (by filename hints: `hero`, `screenshot`, `banner`, etc.).
3. Else if any source URL is a YouTube embed → extract video ID → grab `i.ytimg.com/vi/{id}/maxresdefault.jpg`.
4. **Else if Project is `shouldFeature=true` → GENERATE a sober banner via `google/gemini-3.1-flash-image-preview` (via OpenRouter), grounded in `project.title` + `project.purpose` + `project.tags`. See §8.4 for the prompt template.**
5. Resize via `sharp`: 1200×630 hero, 400×400 thumbs.
6. Upload to R2 at `media/{handle}/projects/{projectId}/hero.webp`.
7. Emit `HAS_MEDIA` edge: `Project -HAS_MEDIA-> { kind: "hero", r2Key, source: "og" | "readme" | "youtube" | "generated" }`.
8. If all four tiers fail (API error, timeout, unsafe-content refusal) → emit NO `HAS_MEDIA` edge; render layer falls back to initials-avatar (§8.5).

For each `Company` / `School` with known domain:

1. Clearbit logo API: `https://logo.clearbit.com/{domain}`.
2. If 404, Google favicon: `https://www.google.com/s2/favicons?domain={domain}&sz=128`.
3. Download + normalize to 128×128 WebP.
4. Upload to R2 at `media/{handle}/companies/{domainSlug}/logo.webp`.
5. **If 1–2 fail OR domain is unknown, emit NO logo edge — the render layer paints initials+color at view time (§8.5). We deliberately DO NOT generate fake company logos via AI (fake Stripe/Google logos would be user-hostile).**

### 8.2 Dependencies

Add `sharp` to `apps/worker/package.json`. Platform-native, already works on Fly's Linux runtime.

### 8.3 Budget

- Per scan: ~20 real-image downloads × ~200KB each = 4MB bandwidth + 5MB R2 storage
- Banner generation: ~0-6 images (only for featured projects that missed tiers 1-3). At ~$0.003/image for `gemini-3.1-flash-image-preview` → **~$0.00-0.02 per scan**
- Wall-clock: ~30s parallelized for downloads + ~15s parallelized for banner gen
- The gen tier runs LAST so it only spends on projects real images couldn't cover

### 8.4 Banner generation (Gemini Flash Image)

**File**: `apps/worker/src/resume/media/banner-gen.ts` (new).

**Model**: `google/gemini-3.1-flash-image-preview` via OpenRouter (same API surface as our text models).

**Prompt template** — kept short + opinionated to guarantee a consistent "sober portfolio" aesthetic across every scan:

```
Generate a sober, minimalist abstract banner image for a software project
portfolio card. 1200×630 landscape.

Project title: {project.title}
What it does: {project.purpose}
Technologies: {project.tags.slice(0, 5).join(", ")}
Project kind: {project.kind}   // e.g. "product", "library", "tool"

STRICT requirements:
- NO text, letters, words, numbers, logos, or typography ANYWHERE in the image.
  (AI text rendering is unreliable; portfolio cards have a real text overlay.)
- Abstract geometric shapes, soft gradients, or flowing forms — never literal
  illustrations of the product, never stock-photo scenes, never people.
- Muted, sophisticated palette (1-3 hues). Avoid pure saturated colors.
  Think: slate + soft blue, warm charcoal + peach, forest + sand.
- Centered composition with a calm focal point. Leave breathing room;
  the viewer's attention goes to the overlaid text, not the image.
- Professional portfolio aesthetic. Think: Apple keynote backgrounds,
  Linear changelog headers, Stripe hero art, Vercel OG images.
- Dark enough to work under white text overlay; not so dark it loses detail.

Output: one image, 1200×630 landscape, no text.
```

**Safety**:
- Model refuses → emit no media; fall back to initials-avatar at render time.
- Output contains text (OCR check post-gen with a small detector, or eyeball on low-confidence score) → regenerate once with a stronger no-text rule; if it still fails, fall back.
- Prompt does NOT include user's full name, email, or private repo content — only public-ish project metadata.

**Provenance**:
- `HAS_MEDIA` edge stores `source: "generated"` so render layer can show a subtle "AI-generated banner" tooltip on hover (future polish). For now, no visible indicator — the banner just works.
- R2 key: `media/{handle}/projects/{projectId}/hero-generated.webp`. The `-generated` suffix is stored so if we want to purge + regenerate with better models later, we can target them.

**Opt-out**: a future user setting (not in this PR) can set `disableGeneratedBanners = true` on their profile → pipeline skips tier 4 and goes straight to initials-avatar.

### 8.5 Initials-avatar fallback (render-time, not fetch-time)

When a Project has no hero image or a Company has no logo, the web render layer paints a Gmail-style initials avatar. This is **100% CSS + a tiny helper** — we never generate or upload placeholder images to R2.

**Helper**: `apps/web/lib/initials-avatar.ts` — tiny pure functions.

```ts
export function initialsFor(name: string): string {
  // "Flightcast" → "F"
  // "AI Muse" → "AM"   (first letter of first two words)
  // "Yatendra Kumar" → "YK"
  // "gitshow" → "G"
  const words = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return words.map(w => w[0].toUpperCase()).join("").slice(0, 2) || "?";
}

/**
 * Deterministic color from an input string. Uses a small palette of
 * Gmail-style muted tones (never too bright, always white-text-legible).
 * Same input always produces the same color across scans + sessions.
 */
export function avatarBgFor(name: string): string {
  const palette = [
    "#e57373", "#f06292", "#ba68c8", "#9575cd",
    "#7986cb", "#64b5f6", "#4fc3f7", "#4dd0e1",
    "#4db6ac", "#81c784", "#aed581", "#ffb74d",
    "#ff8a65", "#a1887f", "#90a4ae",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return palette[Math.abs(hash) % palette.length];
}
```

**Component**: `apps/web/components/ui/initials-avatar.tsx` — renders:

```tsx
<div
  className="flex items-center justify-center rounded-md text-white font-medium"
  style={{ backgroundColor: avatarBgFor(name), width: size, height: size, fontSize: size * 0.4 }}
>
  {initialsFor(name)}
</div>
```

**Where it gets used** (render-time decision, no worker change):

- Project card: if `project.media?.hero` is undefined → render `<InitialsAvatar name={project.title} size={...}>` instead of the image slot.
- Work entry: if `work.logoUrl` is undefined → render `<InitialsAvatar name={work.company} size={40}>` as the logo circle.
- Education entry: same pattern with `school` name.

**Why render-time, not fetch-time**:

- Zero R2 storage cost, zero pre-generation wall-clock
- Deterministic across scans (company "Flightcast" always gets the same color)
- No 404 risk — always renders
- Dark-mode compatible (palette has good contrast on both themes; can swap palette per theme)
- Matches Gmail / GitHub / Slack conventions users already recognize as "no image"
- Works for companies whose domain we couldn't infer (initials from the company name directly)

---

## 9. Render layer detail

File: `apps/worker/src/resume/render/render-from-kg.ts` (new). Replaces the current `assemble.ts` + all section agents' role as Resume-writers.

### 9.1 Flow

```ts
export async function renderResumeFromKG(
  kg: KnowledgeGraph,
  opts: { session, usage, trace? }
): Promise<Resume>
```

Each Resume section is a pure projection:

```ts
resume.work = kg.edges
  .filter(e => e.type === "WORKED_AT" && (e.band === "verified" || e.band === "likely"))
  .sortBy(e => e.attrs.end ?? "9999")
  .reverse()
  .map(edge => ({
    id: edge.id,
    company: getCompany(edge.to).canonicalName,
    title: edge.attrs.role,
    start: edge.attrs.start ?? "",
    end: edge.attrs.present ? "Present" : (edge.attrs.end ?? ""),
    logoUrl: mediaFor(edge.to, "logo"),
    description: edge.attrs.description ?? "",
    // ...
  }));

resume.education = kg.edges.filter(e => e.type === "STUDIED_AT" && band >= "likely").map(toEducationEntry);

resume.skills = kg.edges.filter(e => e.type === "HAS_SKILL").sortBy(evidenceWeight).slice(0, 15).map(toSkill);

resume.projects = kg.entities.projects
  .filter(p => p.shouldFeature)
  .sort(rankBlend) // pinned-gh > stars > polish > effort > recency > diversity
  .slice(0, 6)
  .map(toProjectCard);

resume.buildLog = kg.entities.repositories
  .filter(r => judgeFor(r).kind ∈ {product, library, tool, experiment, fork-contribution})
  .sortBy(userFirstCommit).reverse()
  .map(toBuildLogEntry);

// Blog = Publication nodes with kind=blog
resume.blog = kg.entities.publications
  .filter(p => p.kind === "blog")
  .sortBy(publishedAt).reverse().slice(0, 20);

// Publications = research/paper/preprint/talk/podcast (for persona 6)
resume.publications = kg.entities.publications
  .filter(p => p.kind in {paper, preprint, talk, podcast})
  .sortBy(publishedAt).reverse().slice(0, 30)
  .map(toPublicationEntry);

// Hackathons = Achievement nodes with kind=hackathon → own Resume.hackathons section
resume.hackathons = kg.entities.achievements.filter(a => a.kind === "hackathon").map(toHackathonEntry);

// Note: designer/creator persona (visual-first cards for design-project and
// video-content) is explicitly deferred to a later PR per §19.1.
```

### 9.2 Hero + About prose

One Opus call, bounded input:

- Top 5 verified edges (WORKED_AT, STUDIED_AT, WON)
- Top 3 featured Projects (title + one-line purpose)
- Cross-section-link requirement (same as current `person` agent)

Output: `description` (one-liner) + `summary` (About paragraph).

Grounded: the prompt lists facts from the KG explicitly and says "every claim in your prose must map to a fact I gave you". No DevEvidence cards handed in raw — the KG already absorbed their content via typed facts.

### 9.3 Resume schema changes

File: `packages/shared/src/resume.ts` — add `hackathons` and `publications` sections.

```ts
hackathons: Array<{
  id: string;
  title: string;
  date?: string;
  description?: string;
  sources: Array<{ label: string; href: string }>;
}>;

publications: Array<{
  id: string;
  title: string;
  kind: "paper" | "preprint" | "talk" | "podcast" | "video";
  venue?: string;      // conference, journal, podcast host, etc.
  publishedAt?: string;
  url: string;
  doi?: string;
  coAuthors?: string[];
}>;

// Project card can carry richer media for visual personas:
projects: Array<{
  // ...existing fields...
  kind: "code" | "research-artifact";
  media?: {
    hero?: string;            // r2 URL — OG image from project homepage or README first image
    screenshots?: string[];   // r2 URLs
  };
}>;
```

Web render: three new components, each conditionally rendered when the corresponding Resume field is non-empty — no cluttering of profiles that don't have that kind of content.

- `apps/web/components/sections/hackathons.tsx` — achievement cards. After Work, before Projects.
- `apps/web/components/sections/publications.tsx` — chronological paper/talk/podcast list with venue + coauthors. After Education, before Projects. Collapsed beyond top-10 with "show all".
- `apps/web/components/sections/projects.tsx` — existing project grid gains `media.hero` rendering when present (hero image above title). Image-first variant for designer/creator personas is §19.1 deferral.

Sections only render when their data exists. An indie-builder profile has no `publications`, and that section simply doesn't appear — not an empty header.

### 9.4 Live scan-progress UX with `ai-elements`

During the 15-60 min scan, the user stares at `/app/scan/{scanId}`. Today it renders a custom phase-card system (built in session 7). This PR rebuilds it using the `ai-elements` component library for a polished "AI is actively working on your portfolio" experience that matches the Claude Code / Claude.ai aesthetic users recognize.

**Why rebuild**: the scan is intrinsically agentic — Reasoning blocks, Tool calls with args + results, Sources, streamed text. The `ai-elements` components are designed for exactly this shape. We already emit the right structured events (`emit: AgentEventEmit` is threaded through `runAgentWithSubmit`); we just render them with the right components.

**Components used** (from the already-vendored `apps/web/components/ai-elements/`):

- `<Conversation>` — top-level scroll container for the scan narrative
- `<Message role="assistant">` — one per pipeline stage
- `<Reasoning>` — collapsible chain-of-thought for each LLM-backed stage (discover, judge, merger, person-prose, evaluator)
- `<Tool>` — renders each tool invocation (TinyFish search/fetch, GitHub API, Playwright fetch, banner-gen) with its input and output
- `<Sources>` — evidence URLs attached to a stage
- `<Conversation.ScrollToBottom>` — auto-scroll as new content streams in

**Live event → component mapping** (scanner emits `PipelineEvent` over the realtime DO WebSocket; scan page listens + dispatches):

| Event kind | Renders as |
|---|---|
| `stage.start` | New `<Message>` with stage name as header, status="running" |
| `stage.end` | Finalize the preceding message; status="done" or "error" |
| `llm.reasoning-delta` | Streams chars into the `<Reasoning>` block for the current stage |
| `tool.start` | Creates a `<Tool name={toolLabel} input={args}>` in the current stage's message |
| `tool.end` | Fills in the `<Tool output={result}>` with the result + duration |
| `fetcher.facts` | Appended as a `<Sources>` card under the stage ("Found N facts") |
| `judge.verdict` | Inline card showing repo name + verdict kind + reason (small emoji badge) |
| `media.banner.generated` | Inline image preview in the projects-stage message |
| `kg.evaluator` | Final summary message with warnings listed as `<Tool.Result>`-style items |

**Rendering order**:

```
[ Stage: github-fetch · done · 3.2s ]
  └─ <Tool name="GitHub API" input={...} output={...repo count...} />

[ Stage: repo-judge · done · 58s ]
  ├─ <Reasoning>
  │   (streams Kimi's per-repo chain-of-thought as it works through each repo)
  ├─ <Tool name="Read README" input={path} output={...} />  (× N repos)
  └─ Verdict cards:
      ✓ ai_buddy — product · shipped · FEATURE
      ✗ Import_BitBucket_Repo — contribution-mirror · HIDE · "auto-generated mock per README"

[ Stage: dev-evidence · done · 4m 12s ]
  ├─ <Reasoning>(planning queries)</Reasoning>
  ├─ <Tool name="TinyFish search" input={query} output={results} /> × 8
  ├─ <Tool name="TinyFish fetch" input={urls} output={pages} /> × batches
  ├─ <Reasoning>(summarizing page N of M)</Reasoning> × 12
  └─ <Sources>
       - hn.ycombinator.com/item?id=...  (snippet preview)
       - ...

[ Stage: render · done · 18s ]
  ├─ <Reasoning>(hero prose generation)</Reasoning>
  └─ Final preview of the rendered hero + summary
```

**Durable-object bridging**: the existing realtime worker at `apps/realtime/` (vendored from session 7) already fans `PipelineEvent` messages from the Fly worker to the browser via WebSocket. The scan page's event-handler logic gets rewritten to map events → ai-elements state, but the transport stays put.

**Where the code lives**:

- `apps/web/app/app/scan/[scanId]/_progress.tsx` — rewritten to use ai-elements components; replaces the current nested-phase-card renderer.
- `apps/web/components/scan/stage-message.tsx` — new wrapper that owns one `<Message>` worth of state and subscribes to its stage's events.
- `apps/web/components/scan/judge-verdict-card.tsx` — tiny card for the per-repo verdicts.
- `apps/web/lib/scan-events-to-ai-elements.ts` — pure function mapping `PipelineEvent` → UI state diffs (testable).

**Fallback for non-streaming events**: some events land at the END of a stage (judge.verdict is emitted post-stage for all repos in one batch; media.banner.generated arrives in the projects stage but each banner is its own event). These animate in after-the-fact via the same component but with no reasoning-delta streams preceding.

**Cost**: UI work only, no new backend. ~1-1.5 days to rebuild the scan page on ai-elements with good polish.

**Won't ship in this PR**: share-a-scan-URL-as-video (showing the agentic scan as a replay). The trace packet has everything needed; a replay player is a separate product feature.

---

## 10. Evaluator detail

File: `apps/worker/src/resume/kg/evaluator.ts` (replaces existing `apps/worker/src/resume/evaluator.ts`).

Runs against the **KG**, not the Resume.

### 10.1 Rules

```ts
// Blocking (retry once, then ship with warning banner if still failing)
- No Person node → fatal
- featured-set contains any Project with kind ∈ {contribution-mirror, dotfiles-config, empty-or-trivial, coursework}
- LinkedIn URL provided + at least one of the 4 scrape tiers succeeded, but 0 WORKED_AT edges → retry with next-lower tier or surface PDF-upload prompt
- Any edge with 0 sources → bug in a fetcher, block

// Warning (log to scan_events + trace, ship)
- LinkedIn URL present but linkedin-public returned 0 typed facts → suggest PDF upload in UI
- Personal site set, fetcher returned 0 typed facts → site is probably JS-heavy
- < 3 Project nodes with shouldFeature=true → thin work surface
- No Achievement nodes despite dev-evidence finding "winner" or "featured" snippets → evidence didn't map to entities

// Nice-to-have (log only)
- Every WORKED_AT edge has an associated Role node
- Every featured Project has purpose populated + at least 3 tags
```

### 10.2 Retry loop

Cap: ONE retry iteration (hard cap, keeps worst-case wall-clock <2× baseline).

On blocking error, identify the smallest set of fetchers that could fix it, re-run those, re-merge, re-evaluate. If still blocking, ship with a `warnings` field on the scan that the web UI surfaces.

### 10.3 Render rule composite

The old `evaluator.ts` checked `resume.work.length >= 1 if hasLinkedIn`. Under the KG model, this check moves EARLIER (on KG edges, before render). The resume schema rules just become shape assertions (Zod).

### 10.4 Partial-failure policy (what happens when a fetcher crashes mid-scan)

Fetchers run independently. One crashing must not kill the scan. Policy:

- Each fetcher's execution is wrapped in `try/catch` at the pipeline level; exceptions become `fetcher.error` trace events and contribute zero typed facts.
- The KG merger runs on whatever facts DID arrive. An empty Company node count is not fatal — it's a warning.
- Evaluator distinguishes: "fetcher crashed" (trace has error event) vs "fetcher ran but found nothing" (no trace error, zero facts). The first is a retryable state; the second is a user-data reality.
- If a crash happens INSIDE the render layer (after KG is built), the KG is still persisted to R2 at `kg/{handle}/scan-{id}.json` so we can retry render later without re-fetching.
- Playwright specifically: hard 20s navigation timeout + 60s per-page total budget. Crashes / OOMs / detached-frame errors are caught at the fetcher layer. Worst case: tier 3 returns null, caller drops to tier 4 (PDF) or ships without LinkedIn data.
- **Fly machine crashes** (process-level): the scan row stays in `running` with a stale heartbeat. Existing D1 heartbeat-watcher marks it `failed` after the grace period. No KG is persisted in this case; user is offered a manual rescan.

### 10.5 Infrastructure note — Fly image size

Adding Playwright + Chromium + sharp to the worker image bumps the build size by **~180-220 MB**. Implications:
- Fly Machine cold boot goes from ~15-20s → ~45-60s. Acceptable since scans are long-running (15-60 min); user sees it as part of the "spawning worker" progress step.
- Image pull time on new regions is longer. If we ever add regions, the first scan there is slow; subsequent ones are cached.
- No change to running-machine memory. Playwright runs only during LinkedIn tier-3; Chromium is spawned per-fetch and torn down after.
- If image size ever becomes a blocker, `playwright-core` + manual Chromium install + only-on-demand browser launch saves ~50 MB. Not worth doing upfront.

---

## 11. Observability extensions

Observability is a first-class product surface for this PR, not a nice-to-have. Every bug we failed to catch in past scans (BitBucket Mirror slipping through, Flightcast fusion failing, LinkedIn walls not detected) would have been obvious from a sufficient trace. The scope: make leak-finding, bug-catching, and quality-regression detection possible from the R2 packet alone, without re-running the scan.

### 11.1 Event kinds

Existing `ScanTrace` (PR #94) gains new event kinds:

```ts
// In packages/shared or apps/worker/src/resume/observability/trace.ts:

// --- Fetchers ---
| { kind: "fetcher.start"; label: string; input: Record<string, unknown> }
| { kind: "fetcher.facts"; label: string; entityType: string; count: number; preview?: TypedFact[] }
| { kind: "fetcher.error"; label: string; error: string; stack?: string; retryable: boolean }
| { kind: "fetcher.end"; label: string; durationMs: number; factsEmitted: number; status: "ok"|"empty"|"error" }

// --- Network / IO ---
| { kind: "github.api.call"; endpoint: string; status: number; rateLimitRemaining?: number; durationMs: number }
| { kind: "inventory.clone"; repo: string; sizeBytes: number; durationMs: number; filesDiscovered: number }
| { kind: "tinyfish.search"; /* existing */ }
| { kind: "tinyfish.fetch";  /* existing */ }
| { kind: "linkedin.tier.attempt"; tier: 1|2|3|4; ok: boolean; durationMs: number; reason?: string }
| { kind: "linkedin.facts.emitted"; positions: number; educations: number; skills: number; tier: number }

// --- LLM ---
| { kind: "llm.call"; /* existing — bounded systemPrompt/input/output, tokens, cost */ }

// --- KG pipeline ---
| { kind: "judge.verdict"; repo: string; kind: string; shouldFeature: boolean; reason: string; filesRead: number }
| { kind: "kg.merger.deterministic"; mergedPairs: number; retainedPairs: number }
| { kind: "kg.merger.llm"; pairCount: number; decisions: Array<{a:string,b:string,decision:string,rationale:string}> }
| { kind: "kg.edge.resolved"; edgeId: string; type: string; sourceCount: number; band: string }
| { kind: "kg.evaluator"; blockingErrors: number; warnings: number; details: Array<{section:string,severity:string,message:string}> }

// --- Media ---
| { kind: "media.download"; kind2: "project-hero" | "company-logo"; url: string; ok: boolean; r2Key?: string; bytes?: number }
| { kind: "media.banner.generated"; projectId: string; model: string; ok: boolean; durationMs: number; r2Key?: string; costUsd?: number; rejectionReason?: string }

// --- Render ---
| { kind: "render.select"; section: string; entityCount: number; filter: string }
| { kind: "render.hero-prose.call"; model: string; durationMs: number; linksEmbedded: number }

// --- Resource metrics ---
| { kind: "stage.resource"; stage: string; memoryMB: number; heapUsedMB: number; diskMB?: number }
```

Every caught exception (try/catch) emits a `fetcher.error` or equivalent with the full stack trace (truncated to 4KB). Silent failures are gone.

### 11.2 What the trace lets us debug

A complete scan trace should answer every one of these questions without re-running:

- **"Why did X not appear in the output?"** → search for X in `fetcher.facts` previews → if missing, no fetcher emitted it → check `fetcher.start` to confirm which fetchers ran → trace back to evidence.
- **"Why did Y appear even though it's noise?"** → `judge.verdict` event for Y's repo → see the reason.
- **"Where did we spend the time?"** → `stage.end` events with durations, sorted.
- **"Where did we spend the money?"** → `llm.call` events with `cost`, summed by label.
- **"Did fusion actually happen?"** → `kg.merger.llm` event with pair decisions.
- **"Did any fetcher crash?"** → filter by `fetcher.error` / `kind === "error"`.
- **"Why did LinkedIn fail?"** → `linkedin.tier.attempt` events per tier with reasons.

### 11.3 audit-trace.ts views

`apps/worker/scripts/audit-trace.ts` gains views:

- `--kg` — print KG entity counts + edge counts with confidence bands
- `--judge` — print every Judge verdict in a table
- `--fetcher=X` — filter events by fetcher
- `--merger` — show all entity-resolution decisions
- `--cost` — LLM spend breakdown by label
- `--errors` — every error/warning event
- `--timeline` — visual ASCII timeline of stage durations (chrome-devtools-style)

### 11.4 trace-linter (new script)

`apps/worker/scripts/lint-trace.ts` — reads a trace packet and flags **anti-patterns** automatically. Intended to run after every scan (and in CI on fixture traces) to catch regressions like "fetcher ran but emitted 0 facts with no error" before they reach users.

Checks:

| # | Check | Signal |
|---|---|---|
| 1 | Fetcher ran (has `fetcher.start`) but emitted 0 facts AND had no `fetcher.error` | Silent empty — probably a parse bug |
| 2 | TinyFish search had ≥1 Failed status | Rate-limit violation or query malformed |
| 3 | LinkedIn tier 3 (Playwright) returned `walled` on every attempt across N scans | Googlebot UA detection has rotated; we need a new strategy |
| 4 | KG has `resolved.pairs` but zero `merge` decisions | Opus pair-resolution prompt is off |
| 5 | Repo Judge emitted >30% `shouldFeature=false` for non-fork/non-archived repos | Judge is too harsh — prompt needs tuning |
| 6 | LLM call with `tokensUsed > 8000` but `output.length < 50` | Likely force-submit retry storm — something's wrong with tool-calling |
| 7 | Same URL appears in ≥3 TinyFish fetches (within one scan) | Dedup regression in dev-evidence |
| 8 | Any event with wall-clock > 120s | Slow-operation outlier; investigate |
| 9 | Total LLM cost > configured budget (default $0.50) | Cost runaway — evaluator/Judge/retry loop misbehaving |
| 10 | `render.hero-prose` output contains fabricated entity (name not in KG) | Hallucination — prompt grounding failed |

Runs stand-alone against a trace file (`bun scripts/lint-trace.ts <scanId>`) OR as a CI step against fixture traces. Exit code 0 = clean, 1 = findings (printed as markdown).

### 11.5 Event retention

- Per scan: ~50-200 events, 100-300 KB JSON. R2 is cheap; keep forever.
- R2 lifecycle rule (future): auto-delete traces older than 90 days for privacy. Not in this PR; add when we have active users.
- Cross-scan aggregation: not supported directly from R2. If we ever want "avg LLM cost per scan over last 30 days", we add a nightly job that summarizes traces into a small D1 table. Post-MVP.

---

## 12. Persistence layout

```
r2://kg/{handle}/latest.json             # source of truth (overwritten per scan)
r2://kg/{handle}/scan-{scanId}.json       # immutable snapshot per scan (for diffing)
r2://resumes/{handle}/draft.json          # projection — existing path, unchanged
r2://resumes/{handle}/published.json      # published projection — existing, unchanged
r2://debug/{scanId}/trace.json            # observability packet — existing, expanded
r2://media/{handle}/projects/{projId}/hero.webp    # NEW
r2://media/{handle}/projects/{projId}/thumb.webp   # NEW
r2://media/{handle}/companies/{domain}/logo.webp   # NEW
```

KG JSON size: 10-100KB per handle. Media: ~5MB per handle.

No new infrastructure. No graph DB. Cross-user recruiter queries (future) project subsets into D1 tables on demand.

---

## 13. Migrations

File: `migrations/0012_kg.sql` (single migration for this whole PR).

```sql
-- `discoverable` flag on users for future recruiter JD-matching.
ALTER TABLE users ADD COLUMN discoverable INTEGER NOT NULL DEFAULT 0;

-- Scan row gains a pointer to its KG snapshot (complements existing access_state / data_sources from mig 0011).
ALTER TABLE scans ADD COLUMN kg_r2_key TEXT;

-- LinkedIn PDF text, when the user uploads a profile PDF, is saved directly
-- onto the scan row before the Fly machine spawns. No separate table needed.
ALTER TABLE scans ADD COLUMN linkedin_pdf_text TEXT;
```

Wipe-free — pure additions, zero data migration risk.

---

## 14. File-level blueprint

New files:

```
packages/shared/src/kg/
  schema.ts                              # Entity/Edge/KnowledgeGraph types
  typed-fact.ts                          # TypedFact<E> union; emitter helper
  slug.ts                                # shared ID derivation

apps/worker/src/resume/
  fetchers/
    linkedin-public.ts                   # Tier 1 + Tier 2 (TinyFish + Jina) — refactor of existing
    linkedin-playwright.ts               # Tier 3 — Playwright + Googlebot UA, NEW
    linkedin-pdf.ts                      # Tier 4 — PDF-text → typed facts
    personal-site.ts                     # website → typed facts
    twitter-bio.ts                       # X bio → typed facts
    hn-profile.ts
    devto-profile.ts
    medium-profile.ts
    orcid.ts                             # researcher: ORCID public API
    semantic-scholar.ts                  # researcher: papers by author name
    arxiv.ts                             # researcher: arxiv search by author
    stackoverflow.ts                     # cross-persona: rep + top tags
  judge/
    repo-judge.ts                        # Kimi reads repo → Judgment
    repo-sampler.ts                      # picks README + top files + manifests
  kg/
    merger.ts                            # deterministic + LLM pair resolution
    evaluator.ts                         # blocks on KG, not Resume
    persist-kg.ts                        # R2 upload for kg/* keys
  media/
    media-fetch.ts                       # orchestrates per-entity media; tiered chain
    og-image.ts                          # OG parse helper
    clearbit.ts                          # logo API wrapper
    image-resize.ts                      # sharp wrapper
    banner-gen.ts                        # Gemini Flash Image generator for missing project banners
  render/
    render-from-kg.ts                    # KG → Resume projection
    hero-prose.ts                        # one Opus call for description + summary

apps/worker/scripts/
  audit-kg.ts                            # pretty-print a handle's KG
  audit-judge.ts                         # print judge verdicts for last scan
  lint-trace.ts                          # anti-pattern linter on R2 trace packet (§11.4)

apps/web/app/privacy/page.tsx
apps/web/app/terms/page.tsx
apps/web/app/api/scan/upload-linkedin-pdf/route.ts
apps/web/components/sections/hackathons.tsx          # achievement cards (after Work)
apps/web/components/sections/publications.tsx        # research papers/talks (after Education)
apps/web/components/app/linkedin-upload-card.tsx     # PDF upload CTA when scrape tiers failed
apps/web/components/ui/initials-avatar.tsx           # Gmail-style fallback for missing images/logos
apps/web/lib/initials-avatar.ts                      # initialsFor() + avatarBgFor() helpers
apps/web/components/scan/stage-message.tsx           # ai-elements <Message> wrapper for one pipeline stage (§9.4)
apps/web/components/scan/judge-verdict-card.tsx      # inline verdict card rendered inside the judge stage
apps/web/lib/scan-events-to-ai-elements.ts           # pure PipelineEvent → UI state mapper (testable)

migrations/0012_kg.sql
sessions/session-8-plan.md               # this file
```

Modified files:

```
packages/shared/src/resume.ts            # add Resume.hackathons[], Resume.publications[], Project.media fields
packages/shared/src/cloud/d1.ts          # minor helpers (no new table)
packages/shared/package.json             # register "./kg" export
apps/web/app/api/scan/route.ts           # unchanged aside from intake URL plumbing
apps/web/app/api/intake/[id]/answers/route.ts  # accept new social URLs (ORCID, Stack Overflow)
apps/web/app/app/page.tsx                # render linkedin-upload-card when evaluator flags missing work
apps/web/app/app/intake/[id]/page.tsx    # new social input fields (ORCID, Stack Overflow)
apps/web/components/data-provider.tsx    # wire hackathons + publications into template data
apps/web/lib/resume-to-data.ts           # add hackathons + publications mappers
apps/web/app/[handle]/page.tsx           # render hackathons + publications sections
apps/web/app/app/scan/[scanId]/_progress.tsx  # rewrite to ai-elements streaming UX (§9.4)
apps/worker/Dockerfile                   # install Chromium for Playwright
apps/worker/src/resume/pipeline.ts       # rewire: fetchers → judge → merger → media → evaluator → render
apps/worker/src/resume/observability/trace.ts  # new event kinds
apps/worker/package.json                 # add sharp, pdf-parse, fast-xml-parser (arxiv), playwright
apps/worker/.env.example                 # TINYFISH_API_KEY documented (already), no new keys

DELETED:
apps/worker/src/resume/pick-featured.ts                     # judge replaces it
apps/worker/src/resume/linkedin.ts                          # split into fetchers/linkedin-*.ts
apps/worker/src/resume/agents/work.ts                       # becomes projection in render-from-kg
apps/worker/src/resume/agents/education.ts                  # same
apps/worker/src/resume/agents/skills.ts                     # same
apps/worker/src/resume/agents/projects.ts                   # same (or kept as per-project research helper for the judge)
apps/worker/src/resume/agents/person.ts                     # → render/hero-prose.ts (one call, KG-grounded)
apps/worker/src/resume/agents/build-log.ts                  # becomes projection
apps/worker/src/resume/evaluator.ts                         # replaced by kg/evaluator.ts
apps/worker/src/resume/assemble.ts                          # render-from-kg.ts replaces it
```

**Blog-import agent stays** — it still emits typed facts for `Publication` nodes.

---

## 15. Build order within the PR

Don't try to do everything in parallel — the dependency graph matters. Work through these in order. Each step compiles + typechecks before moving on:

1. **KG schema + shared types** (`packages/shared/src/kg/`*). Nothing runs yet; just types.
2. **Migration 0012** committed. Apply to local D1.
3. **Playwright infrastructure** — add `playwright` to worker package.json, update `Dockerfile` to install Chromium, smoke-test that headless navigation works on a test page from Fly.
4. **Existing pipeline emits typed facts** (github-fetcher, intake, blog-import refactored to emit — old paths still work). Pipeline runs, KG is populated in-memory but not yet used.
5. **Repo Judge** (`judge/repo-judge.ts`, `repo-sampler.ts`). Wired into pipeline alongside existing pick-featured (both run, judge output goes to trace, not yet used in render).
6. **KG merger** (`kg/merger.ts`). Pipeline builds KG post-fetchers; still not used.
7. **Media fetch** (`media/`*). Runs after merger; downloads start hitting R2.
8. **New fetchers** (personal-site, twitter-bio, hn/devto/medium, linkedin-public refactor, linkedin-pdf). Each adds to KG.
9. **Render from KG** (`render/`*). Resume is now generated from KG.
10. **Evaluator on KG** (`kg/evaluator.ts`). Blocking rules active.
11. **Web UI**: ConnectLinkedIn card, privacy+terms pages, hackathons section, PDF upload endpoint.
12. **Delete old files** (pick-featured.ts, linkedin.ts, agents/*.ts that render-from-kg replaces, old evaluator, assemble.ts).
13. **Observability extensions + audit scripts updates**.
14. **End-to-end test**: run the local smoke scan (`SCAN_HANDLE=<handle> bun apps/worker/scripts/local-scan-smoke.ts`) against at least three diverse handles covering different personas from §2.1 — e.g., an indie builder, an OSS maintainer or corporate engineer, and a student. Fix what each trace reveals. Save per-handle reports to `.smoke-reports/`.
15. **Typecheck + tests + lint** all four workspaces.
16. **Compose PR description**: section-by-section summary + before/after Resume JSON shape + links to the per-handle smoke reports + persona coverage summary.

**Don't skip step 14.** The pipeline will have bugs the trace catches. The three-handle matrix is what proves the pipeline is general, not tuned to one profile shape. Run, pull traces, fix, re-run.

---

## 16. Testing strategy

### 16.1 Unit tests (fast, no network)

Add test files where appropriate:

- `packages/shared/src/kg/schema.test.ts` — entity ID derivation stability
- `apps/worker/src/resume/kg/merger.test.ts` — deterministic merge logic with fixture facts
- `apps/worker/src/resume/judge/repo-judge.test.ts` — just the prompt-assembly helpers
- `apps/worker/src/resume/render/render-from-kg.test.ts` — KG fixtures → expected Resume projections
- `apps/worker/src/resume/kg/evaluator.test.ts` — blocking vs warning classification

### 16.2 Integration test (slow, with keys)

Add `apps/worker/scripts/local-scan-smoke.ts`:

- Reads `SCAN_HANDLE` from env (handle-agnostic — no default to any specific user).
- Runs the full pipeline against real GitHub + TinyFish + OpenRouter.
- Asserts persona-agnostic invariants (the same checks as §17.2): KG validates against schema; no repo with `judge.kind` in the noise-set appears in featured or buildLog; if `resolved.pairs` contains merges, at least one edge has ≥2 sources; etc.
- Writes a markdown summary report to `.smoke-reports/{date}-{handle}.md` for reviewer inspection.
- Exits non-zero if any invariant fails.

Runs manually during development against ≥4 diverse handles (§17.2) + in CI as a nightly against a pinned set of public handles covering distinct personas.

**Smoke-report template** (`.smoke-reports/{date}-{handle}.md`):

```markdown
# Smoke: @{handle} · {ISO-date}
scan id: {scanId} · duration: {min}m{sec}s · cost: ${x.xx}

## Persona notes
Detected shape: {indie / OSS / corporate / student / researcher / mixed}
(auto-derived from KG: star totals, public repo count, has-ORCID, etc.)

## Resume shape
| Section | Count | Notes |
|---|---|---|
| Work        | N | verified/likely/suggested breakdown |
| Education   | N | " |
| Skills      | N | top-5 by evidence weight |
| Featured    | N | pinned-in-GH count, judge-passed count |
| BuildLog    | N | " |
| Publications| N | (if researcher persona) |
| Hackathons  | N | |
| Blog        | N | |

## KG stats
Entities: persons={}, companies={}, schools={}, projects={}, repositories={},
          skills={}, publications={}, achievements={}
Edges: total={}, verified={}, likely={}, suggested={}
Merges (LLM-resolved pairs): {} of {} ambiguous pairs

## Judge verdicts
{table: repo, kind, shouldFeature, reason}

## Invariant checks
- [x/✗] KG schema valid
- [x/✗] No noise-kind repo in featured/buildLog
- [x/✗] If merges happened, ≥1 edge has ≥2 sources
- [x/✗] Authority invariant (when applicable)
- [x/✗] Media coverage (or graceful fallback logged)

## Failures / warnings
{evaluator warnings, any fetcher crashes with reason}

## Notable observations
{executor's freeform 1-paragraph impression of the output quality}

## Links
- [Trace packet](r2://debug/{scanId}/trace.json)
- [KG snapshot](r2://kg/{handle}/scan-{scanId}.json)
- [Rendered portfolio](https://gitshow.io/{handle})
```

The `local-scan-smoke.ts` script generates this automatically by reading the trace + KG; the executor fills in "Notable observations" manually per handle.

### 16.3 Regression fixtures

Save trace packets from real past scans (whose output was bad) into `apps/worker/fixtures/regression/*.json`. Write unit tests that feed those traces through the KG merger + Judge assertion harness, checking for the **class-of-failure** invariants (not specific names):

- Any repo where the source metadata describes an auto-generated mirror / contributions importer / mock must land with `judge.kind = contribution-mirror`.
- Any pair of sources pointing at the same entity with different surface names must be merged in `resolved.pairs`.
- Any fetcher response that's mostly chrome text (no Experience / Education / About sections) must emit 0 typed facts, not fake them.

The receipts we have (`Import_BitBucket_Repo`, `Flightcast` / `video-first podcast platform`, login-walled LinkedIn) exercise these invariants — but the invariants are stated generically so they hold for any user.

---

## 17. Definition of done (merge checklist)

Before merging this PR:

### 17.1 Code health

- All four workspaces typecheck clean
- All unit tests pass (`bun test` across workspaces)
- Migration `0012_kg_and_linkedin.sql` runs cleanly on local D1 + CI's migrate-d1 workflow
- Old files (pick-featured, linkedin.ts, section agents that render-from-kg replaces) deleted — not just renamed
- No Yatendra-specific strings, handles, or repo names anywhere in source code (smoke-test handles are env-configurable)

### 17.2 Persona-covering smoke scans

Run the smoke scan (§16.2) against **at least four different GitHub handles** that collectively cover multiple personas from §2.1. The executor can pick any public profiles — the point is diverse shapes, not specific individuals. Required mix (one handle per persona, overlapping OK):

- one **indie builder** (many repos, low-to-medium stars, personal site + LinkedIn URL)
- one **OSS maintainer** or **corporate engineer** (sparse public GitHub OR high-star repos)
- one **student-or-new-grad** shape (many coursework/tutorial repos)
- one **researcher / academic** with a public ORCID or Semantic Scholar presence (tests ORCID + arxiv + Semantic Scholar fetchers; assert `Publication` nodes exist + `Resume.publications[]` renders)

For each smoke scan, assert the generic invariants below. No assertions that encode a specific person's expected output:

- KG persisted at `r2://kg/{handle}/latest.json` and validates against the `KnowledgeGraph` Zod schema
- Trace at `r2://debug/{scanId}/trace.json` shows:
  - At least one `judge.verdict` event per cloned repo
  - `kg.merger.deterministic` and `kg.merger.llm` events (even if llm pair count is 0)
  - At least one `fetcher.facts` event per configured fetcher
- Resume `draft.json` validates against the updated `Resume` schema (including new `hackathons[]`)
- **Noise exclusion invariant**: the `projects[]` and `buildLog[]` arrays contain **zero entries** whose corresponding Repository has `judge.kind ∈ {contribution-mirror, dotfiles-config, empty-or-trivial, coursework, tutorial-follow, template-clone}`. This is the general form of "BitBucket Mirror must not appear" — it holds for every user regardless of which specific repos they own.
- **Evidence fusion invariant**: if the merger's `resolved.pairs` contains any `"merge"` decisions, at least one edge in the resulting KG has `sources.length >= 2`. This proves fusion actually ran (instead of silently skipping).
- **Authority invariant**: if a user has an ORCID ID that resolves, at least one `Publication` edge has `source.authority === "first-party-api"`. (Skippable for non-researcher handles.)
- **Media coverage**: every `Project` with `shouldFeature=true` has either a `HAS_MEDIA` edge (from tiers 1-4 per §8.1) OR the trace shows all four tiers failed with concrete reasons — in which case the render falls back to initials-avatar (§8.5) and the PR description notes the banner-gen hit rate.
- Smoke-scan summary report (markdown, generated by `scripts/local-scan-smoke.ts`) committed to `.smoke-reports/{date}-{handle}.md` for reviewer inspection.

### 17.3 Product surface

- `/app` shows a "Upload LinkedIn PDF" prompt when the evaluator flagged missing work/education AND no PDF was uploaded yet
- `/privacy` and `/terms` pages live at `gitshow.io/privacy` and `gitshow.io/terms` (first-draft content; legal review can happen later, not blocking)
- Playwright Chromium installs cleanly on the Fly worker image — verified by a local smoke test hitting any non-LinkedIn test URL
- No new CF secrets required beyond what's already configured (TinyFish etc.)
- `apps/worker/scripts/audit-kg.ts <handle>` works against any handle the user has scanned (not hardcoded)
- Web render of a scanned profile (any handle) displays the new `hackathons` section when Achievement nodes exist, `publications` section when researcher data exists, and gracefully omits either when empty

### 17.4 PR description

- Links to each smoke-scan summary report
- Shows one before/after excerpt of the Resume JSON structure (any handle)
- Lists the personas covered in testing

**Post-merge human tasks** (not blocking merge):

- (None required for this PR — no external app submissions, no approval waits. Legal review of `/privacy` + `/terms` is a nice-to-have post-launch.)

---

## 18. Open decisions with chosen defaults

If executor finds a sharper answer during build, document in PR description and we'll debate.

1. **Confidence gating for Work**: strict (`band >= likely`, meaning ≥1 high + ≥1 medium source OR 1 first-party-api) → **chosen default**. Rationale: employment claims must be verifiable.
2. **Featured cap**: 6 → default. Pinned repos fill first, then ranked blend.
3. **Pinned repos auto-qualify**: yes, Judge is advisory for pinned, qualifying for non-pinned → default. **Exception handling**: if the Judge flags a pinned repo as `kind ∈ {contribution-mirror, empty-or-trivial}`, user's explicit pinning still wins (we respect intent) but render it with a lower rank within the featured list, and log a `judge.pinned-conflict` warning so the user can unpin if they want.
4. **Personal site scope**: extract structured facts AND keep prose for hero grounding → default.
5. **LinkedIn PDF parsing**: server-side `pdf-parse` on web worker (Cloudflare runtime — verify it works there; if not, parse on Fly worker). Default: try CF first, move to Fly if bundle explodes.
6. **Discoverable flag default**: `false` → default. User opts in via future Settings UI (not in this PR).
7. **Missing-image fallback chain**:
   - **Projects** (§8.1 tiers 1-4 + §8.5): OG image → README image → YouTube thumb → **Gemini Flash Image generated banner** (§8.4) → initials-avatar (§8.5). Default.
   - **Company/school logos** (§8.1 + §8.5): Clearbit → Google favicon → render-time initials+color avatar. No AI-generated logos (fake brand marks would be user-hostile).
   - Generated banners ship at ~$0.003/image; budget per scan is ~$0.00-0.02 given gen only runs for featured projects that missed all three real-image tiers.
8. **Hackathon detection**: dev-evidence orchestrator specifically asks about hackathons → Achievement nodes with `kind=hackathon`. Alternative: regex on repo names (`*-hackathon`*) — too narrow. Default: dev-evidence-driven.
9. **If LinkedIn scrape chain breaks entirely**: PDF upload tier always works as the ultimate fallback. Evaluator surfaces the upload CTA when work/education come up empty.
10. **Retry loop cap**: 1 iteration → default. Keeps wall-clock bounded.
11. **Smoke-test handle**: `SCAN_HANDLE` env variable on `scripts/local-scan-smoke.ts` → default. Executor must test against ≥3 diverse handles (per §17.2) but the script itself is handle-agnostic. No handle hardcoded anywhere in source.
12. **Persona coverage during build**: when a design decision has a tradeoff, document which personas each option serves better. Default bias when tied: serve personas 1-5 first (highest overlap with the current-product user base), accommodate 6-7 via extensibility.

---

## 19. Non-goals and deferred work

Split into two clean buckets so there's no ambiguity when the next session asks "is X in scope?".

### 19.1 On the roadmap, explicitly deferred to a later PR

Three buckets. Each IS planned, just not in this PR. The KG architecture in this PR is deliberately shaped to accommodate them.

- **Designer / creator persona (persona #7).** Dribbble, Behance, YouTube as primary-signal fetchers + image-first project card rendering. The KG's `Project`/`MediaAsset` entity types are already flexible enough to carry design work — what's missing is the specialized fetchers (platform-specific extraction) and the card-variant UI. Own PR; lands when we have designer-shaped users on the waitlist.
- **Recruiter JD-matching product.** A separate product surface (B2B vs. B2C), distinct UX, distinct pricing tier. The KG in this PR already carries everything JD-matching needs (`discoverable` flag on Person, typed entities, queryable edges). What ships LATER is:
  - JD parser endpoint (Opus extracts `{required_skills, companies, roles}`)
  - Candidate retrieval service (reads across `kg/*/latest.json` where `discoverable=true`)
  - Recruiter UI (paste JD → see ranked candidates)
  - Access controls + consent flows (recruiters pay, candidates opt-in)
  Own PR, own design pass, own deploy.
- **Post-MVP polish items** (small follow-ups, each ~0.5-1 day):
  1. **"Rescan with [new source]" button** on `/app` — triggers a fresh scan after the user adds a new URL (ORCID, LinkedIn, personal site) without re-running the intake Q&A.
  2. **Inline "unpin this repo" action** in the rendered portfolio — when the Judge flags a pinned repo as `kind ∈ {contribution-mirror, empty-or-trivial}`, show a subtle "This repo looks auto-generated — hide from portfolio?" CTA next to the card.
  3. **KG admin / debug UI** at `/app/admin/kg` — renders the current user's KG as an interactive graph (entities + edges + sources). Invaluable for debugging quality issues without SSH'ing to R2.
  4. **Section hide toggles** — user hides a section (e.g. Hackathons, Publications) from their public portfolio if they don't want it shown. Stored on `user_profiles.section_overrides`.
  5. **Inline field edits** — user can override a specific KG-derived claim (typo in a company name, wrong date) via a small edit drawer on their rendered portfolio. Overrides persisted as `user_overrides` alongside the KG, applied at render time.
  6. **LinkedIn Data Portability scope activation** (optional future path). If we ever want to submit a LinkedIn app and go through Member Data Portability approval (2-8 week human process), the portability fetcher is a ~1-day follow-up PR. Scraping covers us today; this is a legitimacy upgrade for later.
  7. **Rate-limit status page** — when TinyFish / OpenRouter / GitHub are rate-limited during a scan, surface it with a friendly "we're throttled, retry in N minutes" UI instead of a hard failure.
  8. **Scan diffing** across consecutive runs — show what changed in the KG (new company, new achievement, re-classified project) so users see the scan's value over time.

### 19.2 Architectural non-goals (not planned at all)

These are decisions we've made to NOT do. If the executor's instinct pushes toward one of these, stop and discuss.

- **Graph database migration.** R2 JSON is fine until recruiter-match volume demands SQL. Revisit when KG cross-user queries start to matter.
- **Session-cookie LinkedIn scraping.** The 4-tier chain (TinyFish → Jina → Playwright → PDF) covers the gap with zero user-account risk. If we ever need cookie-based, it's its own UX review.
- **Incremental KG updates.** Full rebuild per scan is simpler and correct. Optimize only when scan wall-clock or cost demands it.
- **Cached fetcher results across scans.** Each scan does fresh fetches. Caching is a separate optimization PR.
- **AI-generated project thumbnails.** When a real image can't be sourced, fall back to text cards. We never ship synthesized hero images — users can tell.
- **ML/embedding-based entity resolution.** Deterministic + LLM-pair is sufficient and explainable. Embeddings add complexity before we need them.
- **Multi-language Judge.** Kimi handles most languages decently; dedicated non-Latin Judge variants (tighter prompts for Japanese/Chinese/Arabic READMEs) are later tuning work.
- **Automatic re-scan on LinkedIn connect.** Show a "Rescan with LinkedIn" button — don't auto-burn OpenRouter credits.
- **Instagram fetcher** for designer persona. Instagram's anti-bot is aggressive and their consumer API is gated. Designers on Instagram-only (without Dribbble/Behance/site) are an edge case; if it becomes common, revisit.
- **Full Google Scholar scraping.** Semantic Scholar + arxiv + ORCID cover ~95% of research artifacts. Google Scholar's aggressive anti-bot makes it a wasted investment.
- **Medium / Substack payments integration** for creators. We render public posts; we don't index paywalled content.
- **Multi-resume variants** (e.g., "technical resume" vs "product resume" from one KG). Same KG, different projections — nice extension, not in this PR.

---

## 20. Starter-prompt for the session that executes this

Paste into the next session as the kickoff message:

```
I want to execute the plan in sessions/session-8-plan.md in a single PR.

Before starting, read the plan end-to-end — especially §2.1 (personas)
and §2.2 (classes of failure). The goal is a GENERAL pipeline serving
six personas (designer/creator is explicit §19.1 deferral). The BitBucket
/ Flightcast / SIH-2022 examples in §2.2 are illustrative, not acceptance
criteria.

Then:
1. Confirm env setup: TINYFISH_API_KEY already on CF; no LinkedIn OAuth
   app or YouTube API key needed this PR (scrape-only LinkedIn, no
   creator fetchers).
2. Start with step 1 of §15 (KG schema types) and work through the build
   order.
3. At step 14, run the local smoke scan against AT LEAST FOUR diverse
   handles (per §17.2), covering indie builder, OSS maintainer or
   corporate engineer, student, and RESEARCHER with ORCID. Save per-handle
   trace + report to .smoke-reports/.
4. Don't open the PR until every box in §17 Definition of done is ticked,
   including the 6-persona coverage invariants.
5. Stop and ask me if any Open Decision (§18) seems wrong for a case you
   hit.
6. If you encounter a design question not covered in the plan (not a
   persona-specific gap — those are covered or deferred — but an
   architectural edge case), stop and ask rather than guessing. Log it
   in the PR description under "Design questions raised during build"
   with your chosen default.
```

---

## 21. Current state reference (as of this plan)

- `main` at commit `665ee1f` (post-PR #94).
- Resume pipeline produces Resume JSON directly from section agents; no KG.
- Repo Judge does not exist; `pick-featured.ts` uses regex noise filter.
- LinkedIn fetched via TinyFish + Jina public scrape only; no Playwright tier yet; no PDF upload UI yet.
- Observability: `ScanTrace` exists and persists to `r2://debug/{scanId}/trace.json`. Extended in this plan.
- Auth: Better Auth with GitHub only. LinkedIn added in this plan.
- Models: Kimi K2.6 (bulk), Sonnet 4.6 (section), Opus 4.7 (orchestrator) — routed via `modelForRole()` in `packages/shared/src/models.ts`. Used unchanged in this plan.
- Dodo subscriptions gate everything behind Pro. Unchanged.

---

Plan end. ~9-10 working days total. One atomic PR covering six personas (designer/creator is explicit §19.1 deferral).