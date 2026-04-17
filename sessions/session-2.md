# GitShow — Session 2: Multi-Repo Pipeline

**Dates:** 2026-04-16 → 2026-04-17
**Status:** Full multi-repo pipeline shipped end-to-end. First real profile generated with 68/100 quality score on 24 repos.
**Default model:** `anthropic/claude-sonnet-4.6` via OpenRouter (only model; no Haiku)
**Working directory:** `/Users/yatendrakumar/side_projects/gitshow`

---

## TL;DR for the next session

We shipped the **multi-repo profile pipeline**: starting from just a GitHub handle, it fetches 96 repos + 200 PRs via `gh` CLI, tiers them into deep/light/metadata analysis, runs 5 focused agents in a deterministic orchestrator, and produces two outputs — a **rich dashboard profile** (`08-final.json`, with reasoning + evidence + audit trail) and a **lean frontend card** (`09-card.json`, concise for hiring managers).

**First real run** on `yatendra2001`: 24 repos analyzed, 77 minutes wall-clock, 17 agent calls, ~$8-10 cost, evaluator score 68/100.

Key architectural pieces shipped:
1. **Checkpoint persistence** — every phase saves to disk, crash = resume (not restart)
2. **Tiered analysis** — every repo included (no rejection), tier determines depth
3. **Reasoning fields** — every metric has a 2000-char audit trail showing the math
4. **User feedback loop** — `feedback.json` mechanism for users to challenge metrics
5. **Two-tier output** — lean `ProfileCard` for frontend, full `ProfileResult` for dashboard
6. **No iteration caps** — agents run until they're satisfied (2h safety timeout only)
7. **Manus two-layer presentation** — overflow mode, metadata footer, error-as-navigation

If you're picking this up mid-stream: **read this whole doc first**, then check `src/pipeline.ts` (orchestrator) and `src/agents/*.ts` (the 5 agents).

---

## What changed from session 1

Session 1 built the **scanner** — a single-repo CLI that cloned one repo and produced per-repo JSON. Session 2 transforms that into a **profile generator** — starting from a GitHub handle, analyzing an entire developer's footprint across all their repos.

| Aspect | Session 1 | Session 2 |
|---|---|---|
| Input | `--repo <path> --handle <handle>` | `--handle <handle>` |
| Repos analyzed | 1 | 24+ (all significant) |
| Data sources | Local git clone | GitHub API (`gh` CLI) + multiple clones |
| Agent calls | 1 (single agent loop) | 17 (5 agent types) |
| Pre-compute | Front-loaded, ~170K tokens | On-demand, structured JSON |
| Iteration cap | 300 bash calls | Unlimited |
| Output | `ScanResult` JSON | `ProfileResult` + `ProfileCard` |
| Crash recovery | None (full re-run) | Checkpoint resume |
| Cost per run | $0.50–$1.00 | $8–12 (25× more data) |
| Wall-clock | 10–20 min | 60–90 min |

The session-1 scanner is **deleted** — `scanner.ts`, `prompts.ts`, `schemas-legacy.ts`, and the `scan` CLI mode are all gone. Everything is profile-only now.

---

## Architecture

```
                ┌──────────────────────────────────────────┐
                │  CLI: bun run profile -- --handle <X>    │
                │  (src/scan.ts → src/args.ts → pipeline)  │
                └──────────────────┬───────────────────────┘
                                   ▼
         ┌─────────────────────────────────────────────────┐
         │  src/pipeline.ts (deterministic orchestrator)    │
         │  + src/checkpoint.ts (resume from any phase)    │
         └─────────────────────────────────────────────────┘
              │
              ▼
  ┌─────────────────────────────────────────────────────────────────┐
  │  Phase 1: GitHub Discovery    (src/github-fetcher.ts)           │
  │  ├─ gh api /user/orgs         → 5 orgs                          │
  │  ├─ gh repo list <handle>     → 94 owned repos                  │
  │  ├─ gh repo view <org/name>   → 2 org repos where user active   │
  │  ├─ gh search prs --merged    → 200 authored PRs                │
  │  └─ gh api /users/.../events  → 100 recent events               │
  │  Saves: 01-github-data.json                                     │
  └─────────────────────────────────────────────────────────────────┘
              │
              ▼
  ┌─────────────────────────────────────────────────────────────────┐
  │  Phase 2: Repo Filtering      (src/repo-filter.ts)              │
  │  Tiered assignment (NO rejection):                              │
  │  ├─ deep     : 25 repos (clone + FIFO + agent)                  │
  │  ├─ light    : 43 repos (not analyzed yet in current pipeline)  │
  │  └─ metadata : 28 repos (API data only)                         │
  │  Saves: 02-filtered-repos.json                                  │
  └─────────────────────────────────────────────────────────────────┘
              │
              ▼
  ┌─────────────────────────────────────────────────────────────────┐
  │  Phase 3: System Mapping      (Sonnet, 1 call, ~30s)            │
  │  Groups all 96 repos into logical systems                       │
  │  Example output: Memcast Platform (8 repos), FlightCast (2),    │
  │                  Autotext (3), Pikc (2), etc.                   │
  │  Saves: 03-systems.json                                         │
  └─────────────────────────────────────────────────────────────────┘
              │
              ▼
  ┌─────────────────────────────────────────────────────────────────┐
  │  Phase 4: Deep Repo Analysis  (Sonnet, ×N parallel)             │
  │  For each deep-tier repo:                                       │
  │  ├─ gh repo clone → temp dir                                    │
  │  ├─ getStructuredInventory() → FIFO + blame + ownership matrix  │
  │  ├─ if userCommits >= 5: run repo-analyzer agent                │
  │  ├─ if < 5: buildMinimalAnalysis() (no LLM, from pre-compute)  │
  │  └─ delete temp clone                                           │
  │  Saves: 04-repo-<name>.json (one per repo)                      │
  │  Concurrency: 3 parallel (configurable via --concurrency)       │
  └─────────────────────────────────────────────────────────────────┘
              │
              ▼
  ┌─────────────────────────────────────────────────────────────────┐
  │  Phase 5: External PR Analysis (Sonnet, ×M)                     │
  │  For each external repo with merged PRs (top 5)                 │
  │  Saves: 05-external-<name>.json                                 │
  └─────────────────────────────────────────────────────────────────┘
              │
              ▼
  ┌─────────────────────────────────────────────────────────────────┐
  │  Phase 6: Profile Synthesis   (Sonnet, 1 call, ~5 min)          │
  │  Input: all per-repo analyses + systems + GitHub data           │
  │  Output: hook, subtitle, 3 metrics with reasoning, radar (4-8), │
  │          6 insights (≥2 with charts), shipped systems,          │
  │          technical depth, code review profile                   │
  │  Built-in self-critique checklist (10 points) before submit     │
  │  Saves: 06-synthesis.json                                       │
  └─────────────────────────────────────────────────────────────────┘
              │
              ▼
  ┌─────────────────────────────────────────────────────────────────┐
  │  Phase 7: LLM Evaluation      (Sonnet, 1 call, ~30s)            │
  │  Independent judge scores profile 0-100 on 5 rubric dimensions  │
  │  If score < 40: re-run synthesis with evaluator feedback        │
  │  Saves: 07-evaluation.json                                      │
  └─────────────────────────────────────────────────────────────────┘
              │
              ▼
  ┌─────────────────────────────────────────────────────────────────┐
  │  Phase 8: Validation + Output                                   │
  │  Deterministic checks (formula consistency, completeness)       │
  │  Derives ProfileCard from ProfileResult via toProfileCard()     │
  │  Saves: 08-final.json (dashboard) + 09-card.json (frontend)     │
  └─────────────────────────────────────────────────────────────────┘
```

---

## Tech stack (no changes from session 1)

- **Runtime:** Bun 1.2.2
- **Language:** TypeScript (strict, ES2022)
- **Schema validation:** Zod v4 (`import * as z from "zod/v4"`)
- **LLM:** OpenRouter via `@openrouter/agent` + `@openrouter/sdk`
- **GitHub data:** `gh` CLI (already authenticated, no custom API wrapper)
- **Dependencies:** 4 runtime (`@openrouter/agent`, `@openrouter/sdk`, `dotenv`, `zod`)

---

## File layout (22 files, 6,800+ lines)

```
gitshow/
├── src/
│   ├── scan.ts                  # CLI entry (profile mode only)
│   ├── args.ts                  # CLI arg parsing (--handle, --model, --concurrency, --feedback)
│   ├── types.ts                 # Shared pipeline types
│   ├── schemas.ts               # Zod schemas + ProfileResult + ProfileCard + toProfileCard()
│   ├── tools.ts                 # Manus two-layer bash execution
│   ├── git-inventory.ts         # Pre-compute engine (evolved from session 1, caps removed)
│   ├── github-fetcher.ts        # gh CLI wrappers + multi-identity + org discovery
│   ├── repo-filter.ts           # Tiered analysis assignment (NO rejection)
│   ├── checkpoint.ts            # Persistent checkpoint system (resume from any phase)
│   ├── feedback.ts              # User feedback loading + injection into agent prompts
│   ├── pipeline.ts              # Deterministic orchestrator (all 8 phases)
│   │
│   ├── agents/
│   │   ├── base.ts              # runAgentWithSubmit<T>() + retry logic
│   │   ├── system-mapper.ts     # Agent 1: groups repos into systems
│   │   ├── repo-analyzer.ts     # Agent 2: per-repo deep analysis (Sonnet ×N)
│   │   ├── pr-analyst.ts        # Agent 3: external PR evaluation
│   │   ├── synthesizer.ts       # Agent 4: profile synthesis (the big one)
│   │   └── evaluator.ts         # Agent 5: LLM-as-judge quality scorer
│   │
│   └── prompts/
│       ├── system-mapper.ts     # ~50 lines
│       ├── repo-analyzer.ts     # ~120 lines (evolved from session-1 prompt)
│       ├── pr-analyst.ts        # ~60 lines
│       ├── synthesizer.ts       # ~160 lines (with language rules + self-critique)
│       └── evaluator.ts         # ~70 lines (scoring rubric)
│
├── profiles/
│   └── <handle>/
│       ├── checkpoint.json       # Pipeline state (phase, completed repos, errors)
│       ├── 01-github-data.json   # Raw GitHub API data
│       ├── 02-filtered-repos.json # Tiered repo list
│       ├── 03-systems.json       # System mapping
│       ├── 04-repo-<name>.json   # Per-repo analysis (one file per cloned repo)
│       ├── 05-external-<name>.json # External PR analysis
│       ├── 06-synthesis.json     # Synthesized profile draft
│       ├── 07-evaluation.json    # Evaluator scores + feedback
│       ├── 08-final.json         # FULL ProfileResult (dashboard)
│       ├── 09-card.json          # LEAN ProfileCard (frontend)
│       └── feedback.json         # (optional) User corrections
│
├── scripts/
│   └── smoke-inventory.ts       # Pre-compute smoke test (no LLM)
│
└── sessions/
    ├── session-1.md
    └── session-2.md             # This file
```

---

## Key design decisions (the reasoning behind the code)

These took significant iteration. Don't re-litigate unless materially wrong.

### 1. Analyze ALL repos, tier by depth (don't reject)

**Originally** the filter rejected repos with <5 commits, no language, or too stale. This caused the first run to miss the user's biggest repo (`doac-stuff/flightcast-core` — 2,683 commits) because it's an org repo not owned by the handle.

**Fix:** tiered analysis instead of rejection.
- **deep**: any repo with a real programming language + recent activity (pushed <2y ago) → clone + FIFO + agent
- **light**: repos with activity but no code language → clone + basic inventory
- **metadata**: archived forks, empty repos → GitHub API only

Every repo appears in the profile. Tier determines depth, not inclusion.

**Also fixed:** org repo discovery. `/users/{handle}/orgs` (public) returns empty when membership is private. Used `/user/orgs` (authenticated) + cross-referenced with PRs/events to find repos the user contributes to in orgs.

### 2. Checkpoint persistence from day one

Session 1 had no crash recovery. When the synthesizer timed out after analyzing 11 repos, all $8-10 of work vanished.

Session 2 writes after every phase:
- After GitHub fetch → `01-github-data.json`
- After filter → `02-filtered-repos.json`
- After system mapping → `03-systems.json`
- **After each repo** → `04-repo-<name>.json` (per-repo, immediate)
- After each external PR → `05-external-<name>.json`
- After synthesis → `06-synthesis.json`
- After evaluation → `07-evaluation.json`
- After validation → `08-final.json` + `09-card.json`

The `CheckpointManager` class tracks current phase, completed repos, agent call count, errors. Re-running `bun run profile` on the same handle **resumes from the last completed phase** — loads everything from disk, only re-runs what wasn't done.

**Verified working:** the first real run crashed on `memcast-v2` with a socket error after completing 8 repos. Re-run loaded those 8 from disk (instant) and continued with the remaining 17.

### 3. Lean frontend card + rich dashboard (two-tier output)

Hiring managers don't need reasoning audit trails. Developers do (for feedback). One output can't serve both.

**`08-final.json` (dashboard)** — has reasoning fields, evidence arrays, per-repo details, temporal data, pipeline metadata. Up to ~25K tokens.

**`09-card.json` (frontend)** — stripped version with just: hook, subtitle, 3 scores with subtitles, radar values, insight cards with charts, shipped projects with highlights, technical depth. No reasoning. No evidence. ~5K tokens.

`toProfileCard(full: ProfileResult): ProfileCard` in `schemas.ts` handles the derivation.

### 4. Reasoning field on every metric (user feedback foundation)

Every durability/adaptability/ownership score has a `reasoning` field (max 2000 chars) that shows the math:

```
"Weighted across 2 repos: flightcast-core 65% (103K lines) + media-system-k8 34%
(12K lines) = 62%. flightcast-core's 35,882 ephemeral LOC is startup iteration —
onboarding prototypes deleted within 6 days. Reclassifying these as durable pivots
raises score to ~72%."
```

A user reads this and can challenge it: "Those deleted files were moved, not removed. Re-run with that context." The reasoning IS the feedback surface.

### 5. User feedback loop via `feedback.json`

In `profiles/<handle>/feedback.json`:

```json
{
  "corrections": [{
    "target": "durability",
    "repo": "doac-stuff/flightcast-core",
    "issue": "The 16 deleted onboarding files were a v2 pivot after 10 months in prod.",
    "expectedImpact": "Should be durable deletions, not ephemeral."
  }]
}
```

When `--feedback` flag is passed, `feedback.ts` loads these and injects them into the relevant agent's prompt with:
> "The developer says X about Y. **INVESTIGATE whether they're right.** Use `run` to check. Do not blindly accept."

The agent investigates (can use `git log --follow` to confirm file moves) and reports: "User is correct on 12 of 16 — those files were moved. Reclassifying as durable. 4 were genuine deletions."

Infrastructure is built, not wired into the CLI end-to-end yet.

### 6. No iteration caps on any agent

Session 1 capped `repo-analyzer` at 300 bash calls. Session 2 uses `maxIterations: 10_000` (effectively unlimited — safety valve only).

The prompts include a **self-evaluation checklist** that runs before the agent submits:
1. Did I verify the formula?
2. Did I actually investigate ambiguous ownership entries?
3. Is every number traceable?
4. Would the developer agree with my deleted-file classifications?
5. Am I being honest about confidence?

Agents now produce MASSIVE reasoning traces (one flightcast-core run had ~30K chars of thinking), but the output quality is noticeably better.

### 7. Manus-style two-layer presentation in `tools.ts`

Replaced the session-1 50KB byte-cap with:
- **Overflow mode**: output >200 lines truncated, full output saved to `/tmp/gitshow-cmd-N.txt`, agent gets navigation hints
- **Metadata footer**: every response ends with `[exit:N | Xms]`
- **Binary guard**: detects binary output, returns `[binary output (N bytes)]` instead of token-destroying garbage
- **stderr always attached**: never dropped
- **Error-as-navigation**: non-zero exit includes guidance

Credit: https://reddit.com/r/LocalLLaMA post by ex-Manus backend lead.

### 8. Dynamic `highlight` metric for shipped projects (no more N/A)

Session 1 output had `durability: "N/A"` on most shipped projects because scores were null for repos <6 months old. Ugly.

**Fix:** Replace fixed `durability` field with `highlight: { label, value }`. Agent picks the most compelling metric per project:

- 6+ months: `{ label: "Durability", value: "62%" }`
- Fast build: `{ label: "Built in", value: "10 days" }`
- Large scope: `{ label: "Scale", value: "60+ components" }`
- Diverse stack: `{ label: "Languages", value: "5 languages" }`
- Team repo: `{ label: "My contribution", value: "27% of codebase" }`

Every project has *something* impressive. The agent finds it.

### 9. Language rules baked into synthesizer prompt

The frontend renders to non-technical hiring managers. The dashboard renders to the developer. Prompts now enforce:

**Frontend text** (hook, subtitles, insight labels):
- Dead simple, no jargon
- No acronyms (OK: "API", "AI". NOT: "FIFO", "LOC", "CI/CD", "RSC", "SSR")
- First person, short sentences
- "running" not "in production", "changed" not "refactored"

**Dashboard text** (reasoning fields, notes):
- Code-review style, technical OK
- Show the math: "Score = (60,361 + 6,742) / (60,361 + 6,742 + 35,882) = 65%"
- Flag what might be wrong: "16 deleted files counted as ephemeral — if these were moves, score would be ~72%"

Anti-patterns explicitly called out: "High LOC throughput with low defect density" / "Optimized CI/CD pipeline with parallelized matrix builds" — marked as BAD in the prompt so the model avoids them.

### 10. Comprehensive error resilience (3 layers of retry)

Network errors (socket closed, timeout, 502) and SDK parse errors (`Invalid final response: empty or invalid output`) caused multiple failures in the first runs. Three layers of retry now:

**Layer 1: agent runner (base.ts)** — 3 retries with exponential backoff for:
- Timeouts, ECONNRESET, socket hang up, **socket connection closed, ConnectionClosed**
- 502/503/504, 429 rate limit
- Invalid final response, empty or invalid output, JSON parse errors
- maximum context length, output_length

**Layer 2: agent loop (base.ts)** — 3-attempt submit pattern:
1. Full run with extended thinking
2. Forcing retry with previous narrative embedded
3. Schema-only retry with minimal prompt

**Layer 3: pipeline (pipeline.ts)** — 3 retries per repo for transient errors, cleanup temp dirs between attempts, continue pipeline even if one repo fails.

**Also added to `github-fetcher.ts`:** 3 retries with backoff for rate limits and server errors on `gh` CLI commands.

---

## The 5 agents — detailed contracts

### Agent 1: System Mapper
- **Model:** Sonnet 4.6
- **Tools:** `submit_systems` only (no bash)
- **Input:** JSON of all significant+light+metadata repos (96 total for yatendra2001)
- **Output:** `SystemMappingResult { systems[], standalone[] }`
- **Token budget:** ~5K in, ~1K out
- **Prompt lines:** 50
- **Call count per pipeline:** 1
- **Example output (yatendra2001):** 6 systems including Memcast Platform (8 repos), FlightCast Platform (2 repos), Autotext (3 versions), Pikc (2 apps), Solana Web Tools (2), AppFlowy Contributions (2)

### Agent 2: Repo Analyzer
- **Model:** Sonnet 4.6
- **Tools:** `run(command)` (bash in repo) + `submit_repo_analysis`
- **Input:** `StructuredInventory` JSON (typed, not markdown) — includes FIFO lifecycle, blame, ownership matrix, temporal data, commits
- **Output:** `RepoAnalysisResult` — durability/adaptability/ownership with reasoning fields, evidence, commit classifications
- **Token budget:** ~30-80K in, ~8-15K out
- **Prompt lines:** ~120 (evolved from session-1 prompt)
- **Call count per pipeline:** once per deep repo with >=5 commits
- **Small repos (<5 commits):** skip agent, use `buildMinimalAnalysis()` from inventory data directly

### Agent 3: PR Analyst
- **Model:** Sonnet 4.6
- **Tools:** `run(command)` (for `gh pr view`) + `submit_pr_analysis`
- **Input:** PR metadata + diff for one external repo
- **Output:** `ExternalContribution` — significance, summary, languages
- **Token budget:** ~5-20K in, ~500 out
- **Prompt lines:** ~60
- **Call count per pipeline:** top 5 external repos

### Agent 4: Profile Synthesizer (the most important)
- **Model:** Sonnet 4.6
- **Tools:** `submit_profile` only (no bash — pure synthesis)
- **Input:** ALL RepoAnalysis results + System mapping + GitHub data + External contributions
- **Output:** `ProfileResult` minus evaluation fields and pipeline meta
- **Token budget:** ~50-100K in, ~15-25K out
- **Prompt lines:** ~160
- **Call count per pipeline:** 1 (or 2 if evaluator rejects and feedback loop triggers)
- **Self-critique built in:** 10-point checklist before submit (hook specificity, insight data-backing, chart presence, narrative coherence, fairness, etc.)

### Agent 5: Profile Evaluator
- **Model:** Sonnet 4.6
- **Tools:** `submit_evaluation` only
- **Input:** Complete ProfileResult draft + key raw data
- **Output:** `{ score: 0-100, notes, reject: bool, suggestions[] }`
- **Scoring rubric (weighted):**
  - Accuracy 30% (do numbers match evidence?)
  - Insight quality 25% (specific vs generic)
  - Completeness 20% (major signals captured?)
  - Presentation 15% (hook compelling? coherent?)
  - Data-backing 10% (every claim traceable?)
- **Reject threshold:** score < 40 (triggers re-synthesis with feedback)
- **Token budget:** ~10-25K in, ~1K out
- **Prompt lines:** ~70

---

## First real run results (yatendra2001, 2026-04-16)

### Pipeline execution
- **Wall-clock:** 77 minutes
- **Agent calls:** 17 (13 deep repo analyses that ran the agent, 4 repos under 5-commit threshold used minimal analysis, plus system mapper, synthesizer, evaluator)
- **Total cost:** ~$8-12 (mostly the deep repo analyses and synthesizer)
- **Repos found:** 96 (94 owned + 2 from orgs)
- **Repos deep-analyzed:** 24 (1 errored with "Follow-up stream ended" — non-transient SDK error)
- **Evaluator score:** 68/100

### Final profile output

```
Hook: "I build complete AI apps solo in under 2 weeks — and the code keeps running."
Subtitle: "Fullstack Engineer · 3 years · TypeScript, React, Go, Flutter · Startup Infrastructure & AI Tooling"

Durability:   73/100
Adaptability: 88/100
Ownership:    86/100

Radar (6 dimensions): TypeScript/React 88, Backend (Go/APIs) 72, Infrastructure 62,
                       Mobile (Flutter) 60, AI Tooling 68, Code Ownership 82

6 insights including:
- "7 days" — Time to first real commit (flightcast-core)
- "62%" — Code still in use after 6+ months (with byCategory hbar chart)
- "5 days" — Ramp-up time across two codebases (with bar chart)
- "79K lines" — AI course platform built solo in 14 days
- "97%" — First-draft accuracy in a fast team

7 shipped systems:
- FlightCast Platform (2 repos, 20 months, Contributor)
- Memcast — AI Podcast Insights (8 apps, 2022-2025, Solo)
- AI Engineer Learning Platform (14 days, solo)
- Rocket.Chat Flutter SDK (GSoC 2023, open source)
- Pikc — Ingredient Scanner (2 apps, solo)
- Autotext (3 versions, solo, Swift → Python)
- plus more
```

### Evaluator feedback (what to improve)
The 68/100 score flagged 5 issues:
1. "Infrastructure holds up strongest" contradicts K8s repo durability (34%)
2. Code Ownership radar (82) vs metric (97) unexplained 15pt gap
3. "Apr '26" on AI platform is a future date (timestamp bug)
4. Only 3/7 shipped projects have deep repo analysis backing
5. No commit SHAs in evidence entries (synthesizer summarized instead of citing)

These are iteratively fixable via prompt tuning. The core pipeline is sound.

### Errors encountered and fixed
- `Invalid final response: empty or invalid output` — OpenRouter SDK parsing failure when model produces truncated output → added to transient error patterns, retry catches it
- `The socket connection was closed unexpectedly` / `ConnectionClosed` — intermittent network error → added to transient patterns
- One repo (`india_history`) errored with `Follow-up stream ended without a completed response` even after retries — non-transient SDK bug, analysis skipped

---

## How to run

```bash
# One-time setup (assumes session 1 setup is done)
cd ~/side_projects/gitshow
bun install
cp .env.example .env  # add OPENROUTER_API_KEY
gh auth login         # if not already authenticated

# Generate a profile
bun run profile -- --handle yatendra2001

# With custom concurrency (default 3)
bun run profile -- --handle yatendra2001 --concurrency 5

# Override model (default is anthropic/claude-sonnet-4.6)
bun run profile -- --handle someone --model anthropic/claude-opus-4.1

# Also write to a single consolidated file (in addition to profiles/<handle>/)
bun run profile -- --handle yatendra2001 --out results/yatendra2001.json

# If crashed, just re-run — resumes from checkpoint
bun run profile -- --handle yatendra2001

# Clear checkpoint for fresh run
rm -rf profiles/yatendra2001
bun run profile -- --handle yatendra2001

# Typecheck
bun run typecheck

# Pre-compute smoke test (session-1 compat, no LLM)
bun scripts/smoke-inventory.ts ~/path/to/repo yatendra2001
```

---

## Output files

After a successful run, `profiles/<handle>/` contains:

- `checkpoint.json` — pipeline state, errors, completed repos
- `01-github-data.json` — raw GitHub API data (profile, repos, PRs, events, emails)
- `02-filtered-repos.json` — tiered repo lists (deep, light, metadata, external)
- `03-systems.json` — system mapping agent output
- `04-repo-<name>.json` — per-repo analysis (one per cloned repo)
- `05-external-<name>.json` — external PR analysis (if any)
- `06-synthesis.json` — synthesized profile draft (pre-evaluation)
- `07-evaluation.json` — evaluator scores + feedback
- **`08-final.json`** — **full ProfileResult with reasoning, evidence, pipeline meta** → use for **dashboard**
- **`09-card.json`** — **lean ProfileCard, concise for hiring managers** → use for **public frontend**

---

## Known limitations / bugs

These are things we explicitly chose not to fix this session:

1. **Future-dated references** — synthesizer sometimes emits dates from the near future ("Apr '26" when current date is April 17, 2026). The agent confuses current date with the last commit date from data.

2. **Single-repo-source insights reported broadly** — when only 3 of 7 shipped systems have deep analysis, the synthesizer generates insights like "96% analytics code durability" from one repo but phrases them as if across all projects.

3. **Radar vs metric gaps unexplained** — "Code Ownership" radar can show 82 while the ownership metric is 97. The 15pt gap has a reason (reviewToCodeRatio of 0) but the synthesizer doesn't explain it.

4. **Evidence SHAs often missing** — the synthesizer frequently summarizes evidence instead of citing specific commit SHAs. Makes the reasoning harder to verify.

5. **Stars/forks stats ignored** — we have the data but don't surface it (e.g., a repo with 12K stars is just another entry, no popularity boost).

6. **Light-tier repos unused** — 43 repos get classified as "light" but the pipeline doesn't actually clone them. They only appear as metadata. Should clone + basic inventory for cross-system signal.

7. **Temporal aggregation is null** — the pre-compute generates commitsByHour, streaks, etc. per-repo, but we don't aggregate across repos. Synthesizer sees null for `aggregateTemporal`. Temporal insights (late-night merge rate, PR cycle time trend) therefore rely entirely on single-repo data or agent fabrication.

8. **Feedback loop not wired to CLI** — `feedback.ts` exists with load/inject functions, but `--feedback` flag is parsed but not plumbed through pipeline yet.

9. **No baseline/percentile data** — "avg 62%" in the frontend needs real distribution data. Currently not computed (agreed to use "avg not enough data" for v1).

10. **Cost is high** — ~$8-12 per profile is expensive for non-frontier cases. Could drop with:
    - Haiku for light agents (we explicitly disabled this; user wants Sonnet-only)
    - Smaller context windows (synthesizer sees everything; could filter to relevant)
    - Caching (OpenRouter doesn't support prompt caching; Anthropic SDK does)

---

## What's NOT built yet (phase 3+)

This pipeline produces JSON. Nothing renders it yet.

- **Next.js app** — profile page at `/[handle]`, developer dashboard with feedback UI
- **GitHub OAuth** — users sign in with GitHub, trigger their own profile generation
- **Database** — postgres for profiles, users, generation jobs, user-provided overrides
- **Worker/job queue** — current pipeline is synchronous CLI, need background job runner
- **Real-time progress** — websocket or SSE to show phase progress in UI
- **Email notifications** — "your profile is ready" after 60-90 min background job
- **Feedback UI** — dashboard where developers challenge metrics, triggering re-analysis
- **Baseline percentiles** — once we have 50+ profiles, compute real averages
- **Public profile sharing** — `gitshow.io/<handle>` with branded UI matching the React mock

Out of scope for v1 (phase 3+):
- Hiring-side features (search, job postings, matching)
- Billing / Stripe
- Custom domains
- Light-tier repo processing
- External repo deep-cloning (we have PR diffs; not full clones)

---

## Dependencies from session 1 that are now DELETED

All single-repo legacy code has been removed:

- ❌ `src/scanner.ts` — legacy single-repo agent loop
- ❌ `src/prompts.ts` — legacy single-repo prompt (migrated to `src/prompts/repo-analyzer.ts`)
- ❌ `src/schemas-legacy.ts` — old `ScanResult` schema
- ❌ `scan` mode in CLI (only `profile` mode remains)
- ❌ `scan` npm script (only `profile` and `typecheck`)

The `git-inventory.ts` is kept and evolved — it's used by both the old `scripts/smoke-inventory.ts` and the new `getStructuredInventory()` path.

---

## User preferences (carried from session 1, unchanged)

`~/.claude/projects/-Users-yatendrakumar-side-projects-gitshow/memory/`

1. **Ship end-to-end on day 1** — don't gate on calibration
2. **Prefer bun over npm** — `bun install`, `bun run`, `bun src/foo.ts`
3. **Push back when something can be done precisely** — no shortcuts
4. **Accuracy > cost during iteration** — 60-90 min / $8-12 runs are fine

New preferences revealed this session:
5. **Sonnet-only, no Haiku** — user explicitly said "Lets only use sonnet-4.6 for now"
6. **No output caps on agents** — "complete, enormous power to the agent"
7. **All repos analyzed (not filtered)** — "that's the only way to connect the dots"
8. **Every metric needs reasoning** — "the user should be able to tell 'I believe you did this wrong'"
9. **No N/A in frontend** — "N/A isn't the right one"
10. **Language simplicity on frontend** — "so that a non-technical hiring manager can understand"
11. **Checkpoint everything** — "save it in a file so it can continue from there"

---

## Open questions / things to decide in session 3

1. **Do we process light-tier repos?** Currently 43 repos get `light` tier but the pipeline skips them entirely. Cheap to clone + inventory (no agent), would add cross-system signals.

2. **Caching strategy?** OpenRouter doesn't support prompt caching. Switching to Anthropic SDK for synthesizer (largest input) could save 50-70% on that call via caching — but user said no Anthropic SDK in session 1.

3. **Real-time progress UX?** CLI writes to stderr. For a web UI, we need progress events via SSE/websocket. The `onProgress` callback in `PipelineConfig` is wired but emits plain text, not structured events.

4. **Profile page architecture?** Next.js with server components? Static generation? Edge runtime?

5. **Re-generation policy?** When does a profile need refresh? On-demand? Weekly cron? Delta check on GitHub activity?

6. **User override model?** Let users edit `hook` manually? Add KPIs to shipped projects? The schema supports this via nullable fields; UX doesn't exist.

7. **Public vs private GitHub data?** Current pipeline uses authenticated `gh` CLI → has access to user's private repos. Production should use user-authenticated OAuth token; we shouldn't ship a server token.

---

## Quick reference for future sessions

**If picking up where we left off:**
```bash
cd ~/side_projects/gitshow
bun install
bun run typecheck  # should pass
cat profiles/yatendra2001/checkpoint.json | jq .phase  # "complete"
```

**If the pipeline errors mid-run:**
- Most errors now auto-retry (network, SDK parse errors, rate limits)
- Non-transient errors are logged in `checkpoint.json` → `errors` array
- Re-run the same command to resume from checkpoint

**If synthesizer timed out:**
- Check `06-synthesis.json` exists — if yes, you have a draft
- Re-run triggers evaluator on the existing draft
- Synthesizer timeout is 2 hours (was 10 min in early session 2)

**If evaluator gives a low score:**
- Read `07-evaluation.json` → `notes` + `suggestions` for specific issues
- Synthesizer prompt is where most quality issues live (`src/prompts/synthesizer.ts`)
- Edit prompt, delete `06-synthesis.json` and `07-evaluation.json`, re-run

**To see what a specific agent saw:**
```bash
cat profiles/yatendra2001/04-repo-doac-stuff-flightcast-core.json | jq .durability.reasoning
```

**To test the frontend card output:**
```bash
cat profiles/yatendra2001/09-card.json | jq '{hook, subtitle, durability, insights: [.insights[] | {stat, label}]}'
```

**Key reference numbers for yatendra2001 (calibration profile):**
- 96 repos total (94 owned + 2 from org `doac-stuff`)
- 200 merged PRs
- 24 deep-analyzed repos (17 ran agent, 7 used minimal pre-compute)
- 6 systems identified (Memcast Platform = 8 repos is the biggest)
- Evaluator score: 68/100 (first real run, pre-prompt-tuning)
- Total cost: ~$8-12, ~77 minutes wall-clock
- Durability 73, Adaptability 88, Ownership 86

---

**End of session 2.** Pipeline is E2E functional. Output is good enough to power a hiring-manager frontend today, though profile quality will improve significantly with prompt iteration. Next session should focus on: (1) rendering the frontend, (2) fixing evaluator-flagged quality issues via prompt tuning, (3) wiring the feedback loop to the CLI.
