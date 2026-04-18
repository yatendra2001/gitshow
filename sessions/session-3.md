# Session 3 — AI pipeline v2: rewrite, refine, integrate the evaluator

**Dates:** 2026-04-16 → 2026-04-18
**Outcome:** v2 pipeline shipping end-to-end. Hiring-manager evaluator is now an actual revise loop, not informational. Card-layer hard gate on low-confidence claims. Codebase fully generic — zero developer-specific examples in any prompt.

---

## What happens when you run `bun run profile` (the 5-line version)

1. **CLI prompts** for GitHub handle + optional socials (Twitter / LinkedIn / site) + context notes. Creates a scan session whose id doubles as the OpenRouter `session_id` so every LLM call for the scan is grouped in one dashboard view.
2. **Ingest (no LLM)**: `gh` CLI pulls repos / PRs / reviews / events. `repo-filter` tiers the repos by signal. `inventory-runner` clones every deep repo under `profiles/<handle>/repos/` and runs line-level git analysis (commit categorization, daily activity, team-contributor signal, features-shipped + bugs-fixed counts). `normalize` builds a unified Artifact table — every commit / PR / repo / web page gets a stable id.
3. **Six parallel workers** (cross-repo, temporal, content, signal, deep-dive, reviews) each investigate a narrow area with tools (browse_web, search_web, search_github, query_artifacts, read_file, git_log, git_show, fetch_pr_reviews) and produce evidence-bound claims.
4. **Synthesis under a chosen angle**: angle-selector picks one of CREDENTIAL_ANCHOR / OPERATOR_DENSITY / BUILD_CADENCE / DOMAIN_DEPTH; hook writer + critic loop runs five candidates under that fixed angle; numbers (3 custom KPIs preferring recognition > shipped output > commit counts), disclosure (flaw + comeback or null), shipped (up to 7 receipts) all run; assemble merges into Profile.
5. **Polish, guard, gate-and-revise, emit**: copy-editor rewrites every claim for human voice; deterministic guardrails hedge placeholder-shaped low-confidence numbers; profile-critic flags claims; bind-evidence validates artifact references; hiring-manager evaluator scores six axes and runs ONE revision cycle dispatching fixes per axis to the right agent; stability check probes the hook a second time under the same angle; timeline agent builds chart-ready career arc; emit-card writes a slim ~60 KB `14-card.json` for the frontend with all low-confidence claims hard-gated out.

One interactive command → 14-stage checkpointed pipeline → one slim JSON the UI renders directly. Every stage resumable. One `session_id` groups every LLM call in OpenRouter for cost + tracing.

---

## Architecture

### 14 stages, checkpointed at every boundary

```
 1  github-fetch     gh CLI (no LLM)
 2  repo-filter      tiered (no LLM)
 3  inventory        clone + git-inventory per deep repo (parallel, no LLM)
 4  normalize        artifact table + indexes + features/bugs aggregates (no LLM)
 5  discover         1 LLM call — free-form distinctive paragraph + investigation angles
 6  workers          6 parallel LLM calls (cross-repo / temporal / content / signal /
                     deep-dive / reviews)
 7  hook             angle-selector → writer × critic loop (≤2 sub-rounds)
 8  numbers          1 LLM call — 3 custom KPIs (recognition > shipped > commits)
 9  disclosure       1 LLM call — flaw + comeback or null
10  shipped          1 LLM call — receipts list (max 7)
11  assemble         merge to Profile (no LLM)
11b copy-editor      voice pass over every claim and the distinctive paragraph
11c guardrails       hedge placeholder-shaped low-confidence numbers (no LLM)
12  profile-critic   claim-level flagger (confidence adjust, not blocking)
13  bind             validate evidence refs (no LLM)
13b hiring-manager   six-axis evaluator + ONE revision cycle (eval → fix → eval → ship)
13c revise rounds    saved per-round to 13c-revise-round-1.json
14  stability        second writer+critic pass under same angle, Jaccard similarity
14a timeline         chart-ready career arc (1 LLM call)
14b emit-card        slim ProfileCard JSON, low-confidence claims hard-gated
```

### Claim-first output shape

Every user-visible string is a `Claim` with a strict contract:

```ts
{
  id, beat, text, label?, sublabel?,
  evidence_ids: string[]   // min 1 — enforced at the Zod tool boundary
  confidence: "high" | "medium" | "low",
  status: "ai_draft" | "user_approved" | "user_edited" | "user_rejected"
}
```

Claims reference an `Artifact` dictionary (commits, PRs, repos, reviews, releases, web pages). The frontend shows the claim; tooltip reveals the artifacts; revision happens per-claim without re-running the pipeline.

### Tool suite available to agents

| Tool | Purpose |
|---|---|
| `query_artifacts` | filter the pre-fetched artifact table |
| `search_github` | cross-org PR/issue/commit search via `gh` |
| `browse_web` | fetch a URL, return readable text, cache on disk |
| `search_web` | DuckDuckGo HTML search (no API key) |
| `list_tree` / `read_file` / `git_log` / `git_show` | inspect actual source code (lazy-cloned) |
| `fetch_pr_reviews` | pulls non-author, non-bot review comments from a PR |

All budgets unlimited by default — accuracy > throttling.

### Chart-ready data shapes

The frontend never fabricates chart inputs. The card carries:

- `charts.timeline` — `{year, month?, label, note?, type: oss|job|solo|win, major}` entries
- `charts.primary_repo_team` — `{repo, total_commits, contributors: [{name, commits, is_user}]}`
- `charts.primary_repo_daily_activity` — `{repo, days: [{date, ins, del, c}]}` for spike charts

---

## The two-step hook pipeline (the most-iterated subsystem)

```
STEP 1 — angle-selector
  Input:  discover summary + all worker claims
  Output: { angle: CREDENTIAL_ANCHOR | OPERATOR_DENSITY | BUILD_CADENCE | DOMAIN_DEPTH,
            reason: "<one sentence, evidence-cited>" }

STEP 2 — writer (under fixed angle)
  Generates 5 candidates that all lead with the chosen angle. Per-angle playbook
  embedded in the prompt prescribes the required first-sentence shape.

STEP 3 — critic
  Auto-reject gate: no texture-as-headline when identity data exists. Scores 5
  candidates, picks winner OR returns revise instruction.

STEP 4 — stability check (always on)
  Runs a SECOND writer+critic pass under the SAME angle. Word-level Jaccard
  similarity isolates writer variance from angle variance.
```

Why route-then-execute matters: the writer's solution space gets narrowed BEFORE generation, so the five candidates stay focused on one storyline instead of jumping between framings. Stability scores improved meaningfully once the angle was fixed upstream.

---

## The hiring-manager revise loop (the gate that acts)

The user's mental model: *the evaluator is a gate, not a proofreader. If it doesn't think the output is the best response, it should regenerate.*

```
eval (round 0) →
  if PASS → ship
  if REVISE/BLOCK:
    for fix in top_three_fixes:
      hook              → re-run angle-selector + writer + critic (with fix as guidance)
      numeric_integrity → re-run numbers agent (with prior picks + critique)
      disclosure        → re-run disclosure (with prior + critique)
      voice             → re-run copy-editor (with critique)
      evidence          → downgrade affected claims to confidence=low
      pattern_selection → log only (not currently auto-revised)
    re-apply guardrails (idempotent)
eval (round 1) → ship best-seen profile (PASS, REVISE, or BLOCK)
```

**One revision cycle, capped.** Two rounds was producing worse results in practice (round 2 regressed more often than it improved). One round catches the high-impact fixes without overfitting.

**Best-profile tracking** — the loop returns the highest-scoring profile across all rounds, not the last round. Verdict rank is `PASS > REVISE > BLOCK`, then `overall_score` within the same verdict tier. If a revision regresses, we ship the original.

**Loud reporting** — every revise event writes directly to stderr (bypasses the CLI's stream-event filter). The user sees exactly when the angle changes, when a fix dispatches, and when the loop ships a non-PASS verdict:

```
[revise] round 0 verdict: REVISE (65/100, forwardable=false)
[revise] re-running hook: Replace current hook with who/what/scale opener...
[revise] angle changed CREDENTIAL_ANCHOR → OPERATOR_DENSITY: <reason>
[revise] re-running numbers: "1,003 features shipped" reads as misleading...
[revise] round 1 verdict: REVISE (72/100, forwardable=false)
[revise] shipping best-seen verdict=REVISE score=72/100 after 1 revision (final-round was REVISE/72).
[revise] This profile did NOT reach PASS — review the hiring-manager top fixes below.
```

Cost: +2 evaluator calls + up to 5 fix-dispatch calls per scan. Worst case ~7 extra LLM calls. Worth it for the gate-acts-on-its-verdict guarantee.

---

## Card-layer hard gate on low-confidence claims

A one-line rule in `emit-card.ts`:

```ts
const trustedClaims = profile.claims.filter((c) => c.confidence !== "low");
```

Any claim the critic marked unreliable doesn't reach the frontend — period. The full profile (`13-profile.json`) still carries them for audit and user editing; they just don't surface in the `14-card.json` the UI consumes.

This prevents the `"999 features shipped"` / `"1,003 features"` / `"<self-reported credential>"` class of error without any prompt tuning. The critic and the hard gate now do the work the prompts were trying (and failing) to do alone.

---

## Bug log + fixes shipped this session

| Bug | Fix |
|---|---|
| Two commit counts for the same repo (`679` PR-based vs `2,684` git-log) confused every downstream agent | Removed `authored_pr_count` from artifact metadata — only one number per repo reaches the agents |
| OpenRouter SDK throws `"Invalid final response"` / `"Follow-up stream ended..."` / `"Stream ended without completion event"` when tool calls succeed but no trailing message | Lowercased substring match in `isEmptyOutputBug` and `isTransientError`; covers all known variants |
| AI-voice prose ("executed a deliberate pivot", "demonstrates capability") leaked through every agent | Dedicated copy-editor agent with banned-phrase list runs after assemble |
| Unsourced context-note claims (compensation, hackathon names) were stated as verified fact in the distinctive paragraph | Discover prompt treats context notes as **leads, not facts** — they become investigation angles for the signal worker to verify |
| Denominators ("27-engineer org") cited without anchor | Denominator rule in `CLAIM_RULES_BLOCK`: every total must cite the artifact that proves it |
| `fetchAuthoredPRs` capped at 200 + `--merged`-only | Three-pass fetch (merged + closed + open × 1000), deduped. Lifted other GitHub-fetcher caps too |
| Stale v1 checkpoints broke v2 runs | `loadExisting()` detects old format, migrates phase to `github-fetch` for clean restart |
| Hook chose texture-as-headline ("commit message style") when identity data was available | Hook critic auto-rejects identity-buried hooks; writer requires ≥2 identity-lead candidates when employer data exists |
| "999 features shipped" looked like a placeholder | Deterministic guardrails module pairs placeholder-shaped low-conf numbers with their inventory denominator, or hedges with `~` |
| Hook stability across runs was bad (Jaccard 0.17–0.23) | Two-step pipeline (angle-selector → writer) collapses solution space before generation |
| Pattern bloat — 25 patterns shown to evaluator | Card-level primary/secondary split (top-6 by confidence + evidence as primary, rest as secondary) |
| Revise loop was running 2 rounds but round 2 often regressed | Capped at 1 revision; keep best-scoring profile across rounds |
| Revise activity invisible in CLI (stream filter hid it) | Direct stderr writes for `[revise]` events bypass the filter |
| Low-confidence claims surfaced in the UI | Hard-gated at `emit-card` — they exist in the profile, never reach the card |

---

## Generic-prompt audit (last sweep)

Every prompt in `src/agents/` was reviewed for developer-specific hardcoding. All concrete examples that named real companies, projects, hackathons, or maintainers were replaced with template-shape examples (`<company>`, `<N>`, `<named project>`). The pipeline now produces no agent-prompt-induced bias toward any particular developer's data shape.

`grep -rniE "yatendra|flightcast|appflowy|commanddash|doac|rocket.?chat|SIH|ETHForAll|Welltested|Megaphone|RevenueCat|Tevo|ai_buddy|Memcast|TwitterGPT|Diary of a CEO|Rox Works|LeanCode|Steven Bartlett" src/ scripts/` returns clean.

---

## File layout (final)

```
src/
  scan.ts              — interactive CLI (clack + ora + chalk)
  pipeline.ts          — 14-stage orchestrator
  session.ts           — ScanSession + SessionUsage + sanitizeHandle
  schemas.ts           — Zod types (Artifact, Claim, Profile, ProfileCard, Charts,
                         HookAngle, HiringManagerOutput, …)
  checkpoint.ts        — per-stage JSON persistence + v1-migration
  normalize.ts         — github-data + inventories → Artifact table
                         (+ daily_activity, team_signal, features_shipped/bugs_fixed)
  assemble.ts          — worker outputs → Profile
  bind-evidence.ts     — validate every claim resolves to an artifact
  guardrails.ts        — deterministic placeholder-number rewrite
  emit-card.ts         — Profile → slim ProfileCard (60 KB),
                         hard-gates low-confidence claims
  inventory-runner.ts  — clone-and-inventory with retry
  github-fetcher.ts    — gh CLI (repos / PRs / reviews / events / emails)
  git-inventory.ts     — per-repo git-log deep scan
  repo-filter.ts       — tier repos into deep / light / metadata
  revise-loop.ts       — hiring-review → dispatch fixes → re-evaluate; ONE round
  types.ts             — shared internal types
  agents/
    base.ts            — runAgentLoop + runAgentWithSubmit (retry, SDK bug bypass)
    prompt-helpers.ts  — shared input renderers + CLAIM_RULES_BLOCK
    discover.ts
    numbers.ts         — accepts reviseInstruction + priorNumbers
    disclosure.ts      — accepts reviseInstruction + priorDisclosure
    shipped.ts
    copy-editor.ts     — accepts reviseInstruction
    timeline.ts
    profile-critic.ts  — claim-level flagger (not blocking)
    hiring-manager.ts  — six-axis gate (PASS/REVISE/BLOCK + top-three fixes)
    hook/
      angle-selector.ts   — STEP 1 of two-step hook pipeline
      writer.ts           — STEP 2: generates 5 candidates under fixed angle
      critic.ts           — auto-reject gate + scoring
      stability-check.ts  — second writer+critic pass under same angle
    workers/
      base-worker.ts   — shared harness (re-exports helpers)
      cross-repo.ts
      temporal.ts
      content.ts
      signal.ts
      deep-dive.ts
      reviews.ts
  tools/
    web.ts             — browse_web, search_web, search_github, query_artifacts
    code.ts            — list_tree, read_file, git_log, git_show (lazy clone)
    reviews.ts         — fetch_pr_reviews (non-author, non-bot filtered)
scripts/
  run-from-session.ts  — non-interactive pipeline re-run for a saved session
```

Total: ~10,500 lines TypeScript. Typecheck clean.
Env flags: `OPENROUTER_API_KEY` (required), `GITSHOW_DEBUG=1` (verbose stream).

---

## What the CLI prints on completion

```
╭─ Complete
│  profile:    profiles/<handle>/13-profile.json
│  claims:     34 (34 with evidence)
│  artifacts:  3,500
│  llm calls:  17
│  cost:       $0.42
│  hiring mgr: PASS (82/100)  ↗ forward       ← color-coded
│  stability:  stable (hook sim=0.71)         ← color-coded
│  session:    https://openrouter.ai/sessions/...
│  elapsed:    24m 12s
╰──
```

If hiring manager returned REVISE/BLOCK, top-three fixes print under the box as concrete, actionable suggestions for the user to address (or to feed into the frontend's edit UI).

---

## For the next session — deployment

The AI backend is done. Decisions to make for shipping:

1. **Hosting shape**: CLI tool only? CLI + hosted worker? Web app with backend?
2. **Storage migration**: today the pipeline writes JSON under `profiles/<handle>/`. For production this needs to move to S3 / R2 / a database with audit history.
3. **Queue / worker model**: scans are 25–45 min — needs a background-job pattern, not sync request/response.
4. **Frontend**: consumer of `14-card.json`. Framework + hosting choice (Next.js on Vercel? Astro? plain React + Cloudflare Pages?). Renders the six-beat dossier + the three chart shapes.
5. **Auth + user model**: who triggers a scan? Session-owner identity, scan history, sharing permissions, public profile URLs.
6. **Cost controls**: each scan is 15-25 LLM calls + 30-60 web fetches at frontier-model rates. Free-tier limits, per-user rate limits, abuse protection.
7. **Revision UX backend**: endpoint to apply `status: user_edited` to a single claim + regenerate just that slice without re-running the whole pipeline.
8. **The hiring-manager verdict on the page**: surface PASS/REVISE/BLOCK as a banner? Or hide it from end users and only show top-three fixes as edit suggestions?

Artifacts that move out of local disk for production:
- `profiles/<handle>/13-profile.json` — full profile (~3 MB)
- `profiles/<handle>/14-card.json` — slim frontend payload (~60 KB)
- `profiles/<handle>/repos/` — cached clones (tens of MB; consider evict-after-scan)
- `profiles/<handle>/web-cache/` — browse_web cache (small)
- `sessions/<handle>.json` — session pointer for resume
