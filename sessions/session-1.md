# GitShow — Session 1: Scanner Foundation

**Dates:** 2026-04-15 → 2026-04-16
**Status:** Scanner production-ready. App scaffolding not started — that's session 2+.
**Default model:** `anthropic/claude-sonnet-4.6` via OpenRouter
**Working directory:** `/Users/yatendrakumar/side_projects/gitshow`

---

## TL;DR for the next session

We built the **GitShow Scanner**: a Bun/TypeScript CLI that runs an OpenRouter-powered agent against a local git clone and produces structured JSON with three metrics (Code Durability, Adaptability, Ownership). The hard work happens in a deterministic pre-computation layer (FIFO line lifecycle, deleted-file lifecycle with 180-day durable threshold, time-distributed ownership follow-up matrix). The agent reads the pre-computed numbers + cited evidence and submits a final scan result.

We benchmarked **6 models** across two prompt iterations (v4 → v5) and locked in **`anthropic/claude-sonnet-4.6`** as the production model. The Anthropic SDK was ripped out — everything goes through OpenRouter now.

The Next.js app, profile UI, GitHub OAuth, database, signup flow, and worker layer are **not built yet**. Session 1 is just the scanner.

If you're a future session/agent and need to ship something now: **read this whole doc first**, then check `src/scanner.ts` and `src/git-inventory.ts` for the implementation details.

---

## What is GitShow?

From the original product brief: an engineering portfolio platform where developers connect their GitHub, an AI agent reads their code, and a structured profile is generated showing **Code Durability**, **Adaptability**, and **Ownership**. Hiring managers browse profiles backed by real data. Privacy guarantee: source code is never stored, only derived insights.

The three metrics:

- **Code Durability** — how long does the user's code last in production before being meaningfully replaced?
- **Adaptability** — how fast does the user become productive in new areas? How diverse is their tech range?
- **Ownership** — when the user ships, do others have to clean up after them?

Session 1 built the engine that derives these three metrics from a git repo. The product (developer signup, profile pages, hiring side, billing, etc.) is everything else.

---

## What was built in session 1

A single CLI command:

```bash
bun run scan -- --repo <path> --handle <handle> --out scans/<name>.json
```

Produces a JSON file matching the `FinalScanResult` schema in `src/schemas.ts`. The fields (validated by Zod):

- `handle`, `repoName`, `archetype`, `archetypeRationale`
- `repoSummary` — `totalCommitsByUser`, `totalCommitsInRepo`, `firstCommitDate`, `lastCommitDate`, `primaryLanguages`, `activeDays`
- `durability` — `score (0-100)`, `linesSurviving`, `durableReplacedLines`, `meaningfulRewrites`, `noiseRewrites`, `byCategory`, `evidence[]`, `confidence`
- `adaptability` — `rampUpDays`, `languagesShipped`, `recentNewTech`, `evidence[]`, `confidence`
- `ownership` — `score`, `commitsAnalyzed`, `commitsRequiringCleanup`, `soloMaintained`, `evidence[]`, `confidence`
- `commitClassifications` — up to 50 representative commits with category + rationale
- `notes` — agent's narrative summary
- `scannedAt` — ISO timestamp set by the wrapper, not the agent

The schema enforces partial records (e.g., `byCategory` only includes populated keys) and nullable scores when the data can't support a number.

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Runtime + package manager | **Bun** (1.2.2) | User preference (saved in memory). Native TS, faster install, single binary. No `tsx` needed. |
| Language | **TypeScript** (strict, ES2022, bundler resolution) | |
| Schema validation | **Zod v4** (`zod@4.3.6`) | Required by `@openrouter/agent`. Imports use `import * as z from "zod/v4"` for compat. |
| LLM provider | **OpenRouter** (`@openrouter/sdk` + `@openrouter/agent`) | Routes 300+ models behind one API. Native streaming + tool calling + reasoning. Removed `@anthropic-ai/sdk` after locking in OpenRouter as the only path. |
| Default model | **`anthropic/claude-sonnet-4.6`** | Won the v5 model comparison (see below). |
| Env loading | `dotenv` | |

`package.json` has exactly 4 dependencies. No dev-time TypeScript runner — bun runs `.ts` natively.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│ scan.ts (CLI entry)                             │
│   parses args, checks OPENROUTER_API_KEY,       │
│   calls runScanner, writes JSON                 │
└──────────────────────┬──────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────┐
│ scanner.ts → runScanner                         │
│   1. gatherInventory     (deterministic, ~6-15s)│
│   2. runAgentLoop        (LLM, ~5-20 min)       │
│   3. attach scannedAt                           │
│   4. return FinalScanResult                     │
└──────────────────────┬──────────────────────────┘
                       ▼
       ┌───────────────┴───────────────┐
       ▼                               ▼
┌──────────────────┐         ┌──────────────────────┐
│ git-inventory.ts │         │ runAgentLoop         │
│ (Node only,      │         │ (OpenRouter,         │
│  no API calls)   │         │  streaming)          │
│                  │         │                      │
│ - parseAllCommits│         │ - bashTool           │
│ - blame top-50   │         │ - submitTool         │
│ - per-file FIFO  │         │ - getItemsStream     │
│ - deleted-file   │         │ - reasoning: high    │
│   lifecycle      │         │ - forcing retry      │
│ - ownership      │         │                      │
│   matrix         │         │                      │
│ - early-committer│         │                      │
│   detection      │         │                      │
└──────────────────┘         └──────────────────────┘
```

### The pre-computed inventory (the secret sauce)

This is where the scanner's accuracy comes from. **Before any LLM token is generated**, we compute these deterministic facts (~6-15s for a 15K-commit repo):

1. **Parse all commits** — one `git log --all --no-merges --numstat` pass into `ParsedCommit[]` with per-file insertions/deletions.

2. **Resolve git identity** — match `--handle` against `git shortlog -sne --all` using normalized substring + token + email-prefix strategies. Returns `{ name, email, commits }` or null.

3. **Top 50 user files by insertions** — generated/lockfile/binary/migration filtering via `GENERATED_FILE_PATTERNS`.

4. **Per-file blame at HEAD** — for each top-50 file that survives, run `git blame --line-porcelain HEAD` to get `user_lines / total_lines` survival ratio.

5. **Per-file FIFO line lifecycle** (the critical piece) — for each surviving top-50 file:
   - Replay its commit history chronologically
   - Maintain a FIFO batch queue of user-line insertions with timestamps
   - When a non-user commit deletes lines, **proportionally apportion** between user-alive-lines and non-user-alive-lines (not pure FIFO on user batches — that over-attributes)
   - Consume user lines from oldest batch first; classify each consumed line as **DURABLE** (≥180 days alive at deletion time) or **EPHEMERAL** (<180 days)
   - User self-deletions go to `selfRefactoredUserLines` and are **excluded** from durability (positive nor negative)
   - Outputs per-file: `durableUserLines`, `ephemeralUserLines`, `selfRefactoredUserLines`, `userLinesSurvivingEstimate`
   - Aggregate gives `rawDurabilityScore` for surviving files alone

6. **Deleted top-50 file lifecycle** — for each top-50 file no longer at HEAD:
   - Find the deletion commit via `git log --all --diff-filter=D --name-only`
   - Find user's first-touch commit on that file
   - Compute `lifetimeDays = deletionDate - firstTouchDate`
   - Tag `durable` if ≥180 days, `ephemeral` if <180 days
   - Aggregate: `durableUserLocEstimate` + `ephemeralUserLocEstimate`

7. **Ownership follow-up matrix** — for each substantive user commit (>50 LOC of non-generated code, non-merge, meaningful by heuristic):
   - Find all non-user commits within 14 days touching overlapping code files
   - Assemble `OwnershipEntry[]` with the user commit + follow-ups
   - **Time-distributed sampling** so the displayed slice spans the user's full history (not just recent)

8. **Heuristic commit classification** inline on every user commit in the rendered list — `[feature/meaningful]`, `[bugfix/meaningful]`, `[chore/not]`, etc. The agent uses these as starting points and overrides for ambiguous cases.

9. **Early-committer flag** — set if the user was among the first 3 distinct authors with <20 pre-existing commits. Triggers `rampUpDays: null` because there's no existing codebase to ramp up into.

For a flightcast-sized repo (15K commits, 4,417 by user, 28 contributors), the rendered inventory is **~170K tokens** of structured Markdown context that gets passed to the LLM as the initial user message.

### The combined durability formula

```
score = (linesSurviving + durableReplacedLines) /
        (linesSurviving + durableReplacedLines + meaningfulRewrites) × 100

where:
  linesSurviving       = aggregateSurvivingEstimate (from per-file FIFO)
  durableReplacedLines = surviving aggregateDurable + deleted durableUserLocEstimate
  meaningfulRewrites   = surviving aggregateEphemeral + deleted ephemeralUserLocEstimate
  noiseRewrites        = lint/format/etc. — EXCLUDED from formula
```

For flightcast-core: `(10,126 + 44,794) / (10,126 + 44,794 + 19,075) × 100 = 74.2`.

### The agent loop

`runAgentLoop` in `src/scanner.ts`:

1. Constructs `OpenRouter` client with **1-hour timeout** (default 2-min would kill streams mid-reasoning)
2. Defines two tools via `tool()` from `@openrouter/agent`:
   - `bash` — executes commands in the repo via `executeBash` from `src/tools.ts`
   - `submit_scan_result` — captures the final JSON via Zod schema validation
3. Calls `client.callModel({ model, instructions: SCANNER_SYSTEM_PROMPT, input: initialMessage, tools, stopWhen: [stepCountIs(300)], reasoning: { effort: "high" } })`
4. Streams items via `result.getItemsStream()` and prints deltas (messages, reasoning, function calls, tool outputs)
5. **Forcing retry**: if the first attempt finishes without calling submit, re-prompt with the previous narrative embedded verbatim + "you didn't submit, do it now, here's the schema" + `effort: "low"` + `stepCountIs(20)`

The forcing retry exists because some models (Kimi K2.5 most prominently) write narrative like "I'm ready to submit the result" but never actually call the tool. The retry catches this and recovers without the user having to re-run.

---

## Key design decisions (with rationale)

These are the decisions that took real iteration. Future sessions: **don't re-litigate these unless something has materially changed.**

### Durability semantics: "did the code do its job", not "does it still exist"

**Wrong original instinct:** code that no longer exists at HEAD = bad durability.

**Right semantic:** code that lived in production ≥6 months before being replaced = positive signal (it did its job). Only code replaced WITHIN <180 days indicates a durability failure.

**Why we changed it:** The user (Yatendra) pointed out that Pixel deleted ~16 onboarding files in flightcast-core that had been in production for 300+ days. Those weren't durability failures — they were successful features that taught the company what to build for v2. Pixel literally saluted the deleted code before removing it.

The same logic applies to: deliberate feature retirement, product pivots, framework upgrades (e.g., Next.js Pages → App Router), planned v2 rewrites, tech-debt payoff, file splits/consolidations, and self-refactor.

The 180-day threshold is implemented in BOTH the deleted-file lifecycle (file lifetime) AND the FIFO line lifecycle (per-line age at deletion).

### FIFO line tracking (don't accept "can't be measured precisely")

**My initial wrong claim:** "within-file rewrites can't be precisely dated without per-line blame tracking, which is expensive."

**User push-back:** *"There 100% should be a way. Don't shortcut or give up."*

**The fix:** I don't actually need per-line tracking. I can replay `git log --follow --no-merges --numstat -- <file>` chronologically and maintain a FIFO queue of user-line BATCHES with timestamps. Non-user deletions are proportionally apportioned between user-alive and non-user-alive lines, and consumed from the oldest user batch first — classifying each consumed line as durable or ephemeral by its age.

This gives **aggregate per-file precision** (not exact line-level, but the timestamps are correct because we know exactly when batches were created and when deletions happened). For flightcast-core, this surfaces real nuances like:

- `apps/web/src/components/ui/line-chart.tsx`: 884 user insertions, **224 durable** + 8 ephemeral (Talha rewrote it ~300 days after creation → durable)
- `apps/web/src/components/ui/bar-chart.tsx`: same 884 insertions but **237 ephemeral** + 1 durable (changes landed inside the 180-day window → ephemeral)

Same file template, totally different durability stories — because the timestamps disagree.

**General principle:** when my first instinct is "we'll approximate", ask if there's a way to do it exactly first.

### Time-distributed ownership matrix sampling

The ownership matrix has 1799 substantive entries for a flightcast-sized repo. The display budget is 400 entries shown. **Originally** I sorted "with-followups first, then most-recent first" — which collapsed the visible slice to only recent commits and made the agent extrapolate badly for older periods.

**Fix:** sort by date, then take an evenly-spaced slice that spans the user's full history. The agent now sees a representative sample across the whole 616 days, not just the last ~30.

### Forcing-retry in the agent loop

**Failure mode:** Kimi K2.5 ran the full agent loop, generated thorough narrative analysis, computed all the right numbers, and then **never called `submit_scan_result`**. The model said "I'm ready to submit the final result" and ended its turn. The wrapper got nothing.

**Fix:** detect `resultCaptured === false` after the first attempt, then re-call `client.callModel` with:
- The previous narrative embedded verbatim (capped at 30K chars)
- A "you didn't actually submit, do it NOW" forcing message
- The full schema field list inline so there's no excuse
- `reasoning: { effort: "low" }` (analysis is already done)
- `stopWhen: [stepCountIs(20)]` (only need one tool call)

Cost when triggered: ~$0.05 extra. Some models reliably submit (Claude, Grok), some need the retry (Kimi). The retry pattern means we don't have to maintain a per-model whitelist.

### Early-committer flag → `rampUpDays: null`

`rampUpDays` is supposed to measure "how fast does this person become productive in a NEW codebase." For a co-founder/early team member, there IS no existing codebase — the user IS the codebase. Reporting `rampUpDays: 0` would be misleading (it's not "instant ramp-up", it's "no ramp-up to measure").

Detected via `detectEarlyCommitter` in `git-inventory.ts`: user is among the first 3 distinct authors AND there are <20 pre-existing commits before them. For yatendra2001 on flightcast-core, Blake had 8 scaffold commits before yatendra joined → flagged → `rampUpDays: null`.

### Forbidden noise reclassification

After v4 testing, **Claude Sonnet 4.6 was inflating durability scores from 74 → 81** by taking the deterministic `meaningfulRewrites: 19,075` and reclassifying 14,417 of them as `noiseRewrites` without verification. This made the score look better but contradicted the FIFO ground truth.

**Prompt fix in v5:** explicit "do NOT move FIFO-derived lines into `noiseRewrites` unless you have personally `git show`'d specific commits and confirmed they're whitespace/lint only." Plus a sanity check: the final score must be within ±2 of the formula.

In v5, Claude correctly returned `noiseRewrites: 0` and `score: 74` ✓.

### Floor minimums on commitClassifications and evidence

Both Gemini variants in v4 produced perfect math but only **5-6 commit classifications** and **1-2 evidence per metric**. The math was right but the profile looked **empty** to a hiring manager.

**Prompt fixes in v5:**
- `commitClassifications` floor: **30** (max 50). With explicit composition rules: year mix, category mix, anchors, ownership exemplars.
- `evidence` floor per metric: **4** (max 10). With explicit "real SHAs / file paths / `kind` tag / concrete description, not 'many files survive'".
- `byCategory` aggressiveness: aim for **4-6 keys**, only omit a category if you can confirm <500 LOC there.

In v5, Claude jumped to 50 classifications and 7 evidence per metric.

### Why we removed the Anthropic SDK after locking in OpenRouter

Originally we had a dual-provider setup: native `@anthropic-ai/sdk` for Claude + `@openrouter/sdk` for everything else. After v5 testing showed Claude via OpenRouter was the production winner, the dual setup was just dead weight:

- Two import paths to maintain
- Two runner functions (`runAnthropicAgent` and `runOpenRouterAgent`)
- A dispatcher in `runScanner` that picked between them
- Two zod versions to dedupe (the SDK's `betaZodTool` had a v3/v4 type-brand collision)
- Two API keys to manage in `.env`

We removed `@anthropic-ai/sdk`, deleted `runAnthropicAgent`, simplified the dispatcher to a direct call, and simplified `tools.ts` to just `executeBash` + descriptions. The CLI is now single-provider with `--model` as the only model knob.

If we ever need to add native Anthropic back (e.g., for prompt caching that OpenRouter doesn't support), it'd be a deliberate addition with good reason — not a default.

---

## Model comparison results

We benchmarked 6+ models against flightcast-core in two prompt iterations. Reference truth from the deterministic FIFO replay:

```
linesSurviving       = 10,126
durableReplacedLines = 44,794
meaningfulRewrites   = 19,075
score                = 74.2
rampUpDays           = null
soloMaintained       = false
commitsAnalyzed      = 1,799
```

### v4 round (initial prompt)

| Model | Score | linesSurviving | meaningfulRewrites | noiseRewrites | classifications | evidence | Verdict |
|---|---|---|---|---|---|---|---|
| Gemini 2.5 Flash | 74.2 ✓ | 10,126 ✓ | 19,075 ✓ | 0 ✓ | 6 | 3-4 | Perfect math, sparse profile |
| Gemini 2.5 Flash Lite | 74.3 ✓ | 10,126 ✓ | 19,075 ✓ | 0 ✓ | 5 | 1-2 | Equally accurate but skeletal |
| Grok 4 | 74 ✓ | 10,126 ✓ | 19,075 ✓ | 5,000 ⚠️ | 29 | 3 | Headline right, missing fields |
| Claude Sonnet 4.6 (via OR) | **81 ❌** | 10,126 ✓ | 13,000 ❌ | **14,417 ❌** | 49 | 10 | Best evidence + commits, but score inflated via noise reclassification |
| Kimi K2.5 | null ❌ | 35,000 ❌ | 8,000 ❌ | 2,000 ❌ | 24 | 4-5 | Fabricated numbers, set score null as cop-out |

### v5 round (after prompt fixes — noise rule, classification floor, evidence floor, byCategory aggressiveness)

| Model | Score | classifications | evidence | byCategory keys | Verdict |
|---|---|---|---|---|---|
| **🥇 Claude Sonnet 4.6 (via OR)** | **74 ✓** | **50** ✓ | 7 each ✓ | 4 (ui, biz, data, other) | **WINNER** — perfect math + best richness |
| Grok 4.20 | 89 ❌ | 30 ✓ | 4-5 ✓ | 7 (most coverage) | Computed score from byCategory averages instead of FIFO formula. byCategory values look fabricated (uniformly 80-100). Ownership stricter than other models (32% cleanup). |
| Gemini 3 Flash Preview | n/a | 5 | 4 | 2 | **TOTAL HALLUCINATION** — generated profile for fictional user "jdoe" / "awesome-app". Did not read inventory at all. Preview model unsuited for tool calling at this scale. |

**Final winner: `anthropic/claude-sonnet-4.6` via OpenRouter.** Got every key number right after the prompt fix, produced the richest profile (50 classifications, 7 evidence per metric, 1.5K-char notes), and supports the future "transparency dashboard" use case best.

**Cost per run** for flightcast-sized repo (~170K-token inventory + reasoning effort high): roughly **$0.50–$1.00**. Higher than Gemini Flash (~$0.05–$0.10) but the quality difference is meaningful enough to justify the default.

### Models that don't work for this scanner

- **Gemma (any version, free or paid)** — no tool calling support via OpenRouter. Errors with "No endpoints found that support tool use".
- **Most `:free` tier models** — generally no tools, weak instruction following, can't handle 170K-token input.
- **Gemini 3 Flash Preview** — preview model, hallucinated entirely.
- **Kimi K2.5** — generates analysis but doesn't reliably call the submit tool. Forcing-retry recovers it but the underlying numbers are still fabricated.

---

## File layout

```
gitshow/
├── package.json              # Bun + 4 deps (openrouter sdk/agent, dotenv, zod)
├── bun.lockb                 # bun lockfile
├── tsconfig.json             # ES2022 + bundler resolution + strict
├── bunfig.toml               # Local cache workaround for root-owned global cache
├── .env.example              # OPENROUTER_API_KEY only
├── .env                      # gitignored — actual key
├── .gitignore                # node_modules, dist, scans/*.json, .env, .bun-cache/
│
├── src/
│   ├── scan.ts               # CLI entry — parses args, runs scanner, writes JSON
│   ├── args.ts               # CLI arg parsing (handles --flag=value AND glued forms)
│   ├── scanner.ts            # runScanner + runAgentLoop with forcing retry
│   ├── git-inventory.ts      # The deterministic pre-computation (FIFO, lifecycle, matrix)
│   ├── prompts.ts            # SCANNER_SYSTEM_PROMPT — agent's instructions
│   ├── schemas.ts            # Zod schemas for ScanResult + FinalScanResult
│   └── tools.ts              # executeBash + tool descriptions
│
├── scripts/
│   └── smoke-inventory.ts    # Test inventory without API calls — useful for debugging
│
├── scans/                    # All scan outputs go here (gitignored)
│   ├── scan-ai_engineer.json
│   └── scan-flightcast-*.json
│
└── sessions/
    └── session-1.md          # This file
```

---

## How to run

```bash
# One-time setup
bun install
cp .env.example .env
# Edit .env, paste your OpenRouter key from https://openrouter.ai/keys

# Run a scan (uses default model: anthropic/claude-sonnet-4.6)
bun run scan -- --repo ~/path/to/repo --handle yatendra2001 --out scans/my-scan.json

# Override the model
bun run scan -- --repo ~/path/to/repo --handle yatendra2001 --model google/gemini-2.5-flash --out scans/test.json

# Smoke-test the inventory only (no API calls, ~6-15s)
bun scripts/smoke-inventory.ts ~/path/to/repo yatendra2001

# Typecheck
bun run typecheck
```

A scan on a flightcast-sized repo (15K commits, 616 active days) takes **~10-20 minutes** wall-clock and **~$0.50-$1.00** with Claude Sonnet 4.6.

---

## What's NOT built yet (phase 2+)

The scanner produces JSON. Nothing renders it. **Phase 2 is the actual product surface:**

- **Next.js app** — auth (GitHub OAuth via Auth.js), `/[handle]` profile page, settings/edit, marketing page
- **Postgres** — `users`, `profiles`, `ingestion_jobs`, `metrics`, `insights`, `repos_analyzed`
- **Worker** — GitHub Actions or Fly.io Machine that clones the repo, runs the scanner, posts results to the API
- **Profile rendering** — three metric cards, insights list, repo list, hide/unhide UI, share link
- **Connect-GitHub → generate → view** — one-click flow through the whole thing
- **Landing page** — hero, three metrics explained, "generate my profile" CTA

**Out of scope for v1** (phase 3+):
- Job board / hiring side
- Stripe / billing
- Custom domains
- Weekly re-analysis
- Multi-user scaling concerns

### Deferred product feedback: transparency dashboard

During the durability iteration, the user asked for a transparency UI where developers can see WHY their durability/ownership scores are what they are, and dispute them. Each `evidence` entry already has a `kind` field (`deletion_durable`, `cleanup_followup`, `survival`, `rewrite_meaningful`, etc.) so a future UI can filter/group by reason. The scanner outputs the right shape; the UI itself is phase 2+.

---

## User preferences (memory — carry across sessions)

These are saved in `~/.claude/projects/-Users-yatendrakumar-side-projects-gitshow/memory/` and apply to ALL future sessions on this project. Read them before pushing back on any of the user's preferences.

### 1. Ship end-to-end on day 1, iterate from live state

`feedback_shipping_velocity.md`. The user is the founder, will be user zero, and prefers shipping with imperfect output to gating on calibration. Don't propose multi-phase plans with "validate the metric before scaling" gates. They'll correct the output themselves and iterate from a working product.

Also covered here: **don't undersell frontier Claude models** (Opus 4.6 / Sonnet 4.6 can do senior-engineer-level judgment directly — default to "use the model" not "use heuristics first, model on ambiguous cases" unless cost is the specific bottleneck).

### 2. Prefer bun over npm for everything

`feedback_bun_over_npm.md`. `bun install`, `bun run`, `bun src/foo.ts` (not `tsx`). Drop `tsx` from devDependencies. Keep `tsc` for typecheck. Lockfile is `bun.lockb`. Never propose npm/pnpm/yarn as defaults.

### 3. Push back when something can be done precisely

When my first instinct is "we'll approximate", ask if there's a way to do it exactly first. The FIFO line tracker exists because the user pushed back on "within-file rewrites can't be precisely dated."

### 4. Accuracy > cost during iteration

Don't optimize for cost while we're still nailing down the system. Take 200-300 iterations and high reasoning effort if it produces a defensible result. The model can run for 20 minutes and burn $1 if accuracy improves. Cost optimization is something we do AFTER the system is correct, not before.

---

## Open questions / next session prep

When session 2 starts, the user will probably want one of:

1. **Scaffold the Next.js app** — `bun create next-app` or similar, set up the directory layout, define the basic routes
2. **Define the Postgres schema** — users, profiles, ingestion_jobs, metrics, insights, repos_analyzed
3. **Wire up GitHub OAuth** via Auth.js v5
4. **Build the profile page** that renders a `scans/*.json` file as the three metric cards + insights + repo list
5. **Set up the worker** — GitHub Actions (zero-infra) or Fly.io Machine

### Things still undecided

- Whether scans run synchronously when a user signs up, or via a background job queue
- Whether to commit scan JSONs to the database or treat them as artifacts (S3? blob store?)
- How to handle re-scans (cache invalidation, weekly cron, user-triggered)
- Whether the transparency dashboard ships in v1 or phase 3
- Whether the worker is GitHub Actions (zero infra) or Fly.io Machines (more control)
- Profile URL structure: `gitshow.io/[handle]` vs `gitshow.io/dev/[handle]` vs subdomain

### Things to verify when session 2 starts

```bash
# Make sure the scanner still runs end-to-end
cd ~/side_projects/gitshow
bun install                       # should be a no-op
bun run typecheck                 # should pass cleanly
bun scripts/smoke-inventory.ts ~/side_projects/gitshow yatendrakumar  # should print inventory in ~6-15s

# Confirm the scan output schema is what the future app needs
cat scans/scan-flightcast-v5-claude-or.json | jq '.durability, .ownership, .adaptability'
```

---

## Quick reference for future sessions

**If a future session needs to run the scanner immediately:**
```bash
cd ~/side_projects/gitshow
bun run scan -- --repo <path> --handle <handle> --out scans/<name>.json
```

**If the scanner errors with `OPENROUTER_API_KEY not set`:**
```bash
cp .env.example .env  # then edit .env to add the key
```

**If you need to test the inventory without burning API credits:**
```bash
bun scripts/smoke-inventory.ts <repo-path> <handle>
```

**If the agent finishes without submitting (a different model than Claude):**
- The forcing retry should catch it automatically
- If still failing, switch back to `--model anthropic/claude-sonnet-4.6`

**To compare an old scan against a new one:**
```bash
jq '.durability.score, .ownership.score, .adaptability.rampUpDays' scans/scan-flightcast-v5-claude-or.json
```

**Key reference numbers for flightcast-core (the calibration repo):**
- 4,417 user commits / 15,040 total / 616 active days
- 1,799 substantive ownership entries / 947 with follow-ups
- Reference durability score: 74.2
- 24 deleted top-50 files (16 durable / 8 ephemeral)
- Early-committer: yes (Blake had 8 scaffold commits before yatendra joined)

---

**End of session 1.**
