# Session 4 — Backend in the cloud: Fly + R2 + D1, revise-claim, CI/CD, observability

**Dates:** 2026-04-18 → 2026-04-19
**Outcome:** Worker pipeline now runs as ephemeral Fly machines per scan. Every stage mirrors into R2, every event streams to D1, every failure is observable via structured pino logs. New `revise-claim` entrypoint regenerates a single claim against user guidance in 2–6 min. Three GitHub Actions workflows ship the worker image, apply D1 schema changes, and typecheck on every push. Backend is shippable.

---

## What happens when a scan fires now

1. **Web app (Phase 2)** receives `POST /api/scan` from an authenticated user, reads their GitHub OAuth `access_token` out of D1, inserts a `scans` row with `status='queued'`, and calls the **Fly Machines API** to spawn a fresh per-scan VM with `SCAN_ID` + `HANDLE` + `GH_TOKEN` + `GITSHOW_CLOUD_MODE=1` as env.
2. The machine boots the worker image (~10s), hydrates any prior checkpoint files from **R2** under `scans/<scan_id>/…` into `profiles/<handle>/` (0 files on first run, N on retry), and starts a 30-second **heartbeat** to D1.
3. `runPipeline()` runs unchanged from session 3 — but now each `ScanCheckpoint.saveFile` fires an `onSaveFile` hook that mirrors the stage file into R2. Pipeline events (`stage-start`, `stage-end`, `worker-update`, …) stream into the D1 `scan_events` table as they happen.
4. On completion: claims upsert into D1 `claims`, scan row updates to `status='succeeded'` with `cost_cents` / `llm_calls` / hiring verdict / hook similarity populated. `13-profile.json` + `14-card.json` live in R2. Machine `auto_destroy: true` wipes itself.
5. On interrupt (SIGTERM): shutdown handler marks scan `failed` before Fly reaps the VM. On machine crash mid-stage: the heartbeat stops; next retry spawns a fresh VM with the same `SCAN_ID`, re-hydrates from R2, calls `ScanCheckpoint.loadExisting()`, and resumes from the last-completed stage.

A user-triggered revision — `POST /api/claims/:id { action: "regenerate", guidance }` — follows the same path but spawns with a CMD override (`init.cmd = ["bun", "scripts/revise-claim.ts"]`). Only the relevant sub-agent reruns; the claim text in D1 gets replaced; the patched `13-profile.json` goes back to R2. ~2–6 min end-to-end.

---

## Architecture

### Spawn-per-scan, no queue, no worker pool

```
Next.js (Cloudflare Workers, future session)
       │  POST /api/scan
       ▼
Fly Machines API  ──────── POST /apps/gitshow-worker/machines
       │   { env: {SCAN_ID, HANDLE, GH_TOKEN, …},
       │     image: <resolved via Fly GraphQL>,
       │     auto_destroy: true,
       │     restart: { policy: "no" } }
       ▼
ephemeral Fly VM  (shared-cpu-2x, 2048 MB)
       │  CMD bun scripts/run-scan.ts      (scan)
       │  or  bun scripts/revise-claim.ts  (revise, via init.cmd override)
       │
       │  ├── reads scans row from D1
       │  ├── hydrates prior stage files from R2
       │  ├── runPipeline({ session, checkpoint, onEvent })
       │  │    ├── onSaveFile → R2 PutObject
       │  │    └── onEvent → D1 scan_events + scan.current_phase
       │  ├── heartbeat every 30s → D1 scan.last_heartbeat
       │  └── on done → claims upsert + scan row finalized + self-destruct
       ▼
completed state: D1 (row + events + claims), R2 (full profile + card + per-stage blobs)
```

Why spawn-per-scan and not a pool:
- Scans are 25–45 min; parallel scans on a shared worker fight for CPU + disk.
- Per-scan isolation: one user's scan can't clog another's.
- Idle cost is literally $0 because no machine exists between scans.
- Fly machine create+boot is ~5–10s — small relative to a 30-min pipeline.

### Single Docker image, two entrypoints

- Dockerfile CMD defaults to `bun scripts/run-scan.ts` (full scan).
- Machines API spawn for revise overrides via `config.init.cmd = ["bun", "scripts/revise-claim.ts"]`. Same image, different process.
- `FlyClient.spawnScanMachine({ …, initCmd? })` handles both.

### Two storage layers, one truth

- **D1** — authoritative for scan state, progress events, and claims. Queryable from the web app via binding or HTTP.
- **R2** — stage JSON blobs (`01-github-data.json` through `14-card.json`), mirrored one-to-one with local `profiles/<handle>/`. Load from R2 on retry; the existing `ScanCheckpoint.loadExisting` does the rest unchanged.

---

## The R2 checkpoint mirror (zero pipeline changes)

One small change to `ScanCheckpoint`:

```ts
// apps/worker/src/checkpoint.ts
constructor(
  session: ScanSession,
  baseDir = "profiles",
  onSaveFile?: CheckpointSaveHook,   // ← added
) { … }

async saveFile(name: string, data: unknown): Promise<void> {
  await writeFile(join(this.dir, name), JSON.stringify(data, null, 2));
  if (this.onSaveFile) {
    await this.onSaveFile(name, data);   // mirror to R2 in cloud mode
  }
}

// saveMeta now delegates to saveFile so checkpoint.json also mirrors.
private async saveMeta(): Promise<void> {
  await this.saveFile("checkpoint.json", this.meta);
}
```

The cloud entrypoint constructs:

```ts
const ckpt = new ScanCheckpoint(session, BASE_DIR, async (filename, data) => {
  await r2.uploadStageFile(scanId, filename, data);
});
await runPipeline({ session, checkpoint: ckpt, onEvent });
```

Pipeline code unchanged. Local CLI path unchanged (no hook passed → no R2 calls). Exactly one new branch in `saveFile`.

Resume: at boot, `r2.hydrateToLocal(scanId, localDir)` lists `scans/<id>/` and downloads each blob into the local dir. `loadExisting()` reads `checkpoint.json`, sees the last completed phase, and `shouldRun(current, target)` skips replayed stages.

---

## The Fly GraphQL image resolver (the sharp edge nobody documents)

`fly deploy --build-only --image-label latest` does **not** update the app's current release — it only builds and tags. Machines spawned via the API would then 404 on `registry.fly.io/<app>:latest`. Fixed by resolving the current image via Fly's GraphQL API:

```ts
// apps/worker/src/cloud/fly.ts
async getCurrentImage(): Promise<string> {
  const query = `
    query ($name: String!) {
      app(name: $name) {
        currentReleaseUnprocessed { imageRef }
        currentRelease { imageRef }
      }
    }
  `;
  // POST https://api.fly.io/graphql  with Bearer <FLY_API_TOKEN>
  // → "registry.fly.io/gitshow-worker:deployment-01KPGF3ZWDSE21KSNM775MC26M"
}
```

`FlyClient.resolveImage()` is called before every spawn. If the configured `image` is empty or ends in `:latest`, it goes through GraphQL. Otherwise it's used as-is. Spawns stay robust to whatever tag convention Fly picks per release.

---

## The revise-claim entrypoint

**Problem:** user views a generated claim, wants AI to regenerate it against their guidance (e.g. "lead with operator density, drop hackathons"). Don't re-run the full 45-minute pipeline.

**Design:** single-purpose Fly spawn that reruns exactly one sub-agent.

```
POST /api/claims/:id { action: "regenerate", guidance }
  ↓
web app spawns Fly machine with:
  init.cmd = ["bun", "scripts/revise-claim.ts"]
  env     = { SCAN_ID, CLAIM_ID, GUIDANCE, GITSHOW_CLOUD_MODE=1 }
  ↓
scripts/revise-claim.ts:
  1) hydrate local dir from R2
  2) load 05-discover.json, 06-workers.json (unwrap {outputs, …}), 13-profile.json
  3) look up claim in D1, dispatch on claim.beat:
        hook       → runAngleSelector + runHookWriter + runHookCritic  (3 LLM calls, ~3–6 min)
        number     → runNumbersAgent(reviseInstruction, priorNumbers)  (1 LLM call, ~2 min)
        disclosure → runDisclosureAgent(reviseInstruction, priorDisclosure)  (1 LLM call)
        other      → fail with "use status='user_edited' for direct text edits" — no Fly needed
  4) applyGuardrails (idempotent), upload new 13-profile.json to R2
  5) DELETE + re-upsert ALL claims of that beat in D1 (agents produce fresh sets; can't merge safely)
```

Live validation this session:

- **number beat, 2m29s, 1 LLM call.** Guidance: "Fix the three-way commit count conflict. Prefer features_shipped from inventory metadata over raw commit counts." Before: hackathon-recognition KPI. After: `"1,644 shipped to production"` + `"1,003 features and 641 bug fixes landed in flightcast-core over 20 months as founding engineer — from inventory metadata"`. Agent read the guidance, pulled `features_shipped + bugs_fixed` directly from inventory, summed to a headline.
- **hook beat, 6m35s, 3 LLM calls.** Guidance: "Lead with operator density (features+bugs shipped per month) instead of hackathon credentials." Before: `"…won Smart India Hackathon 2022 from 1.5M participants…"`. After: `"…First of 27 engineers; one hotfix per 1.4 days in early 2026 while building the VAST ad server and Megaphone migration solo."` Hackathons dropped, 1.4-day-hotfix cadence leads.

**Known limitation:** regenerating one `number` claim regenerates all three (the numbers agent picks a fresh set). Same for disclosure. User-edits (`status='user_edited'`) are the per-claim lever; regenerate is per-beat.

---

## D1 resilience — retry + failure counter

Session 3 ended with a suspicion that D1 writes were silently failing mid-scan (heartbeat appeared stale while the pipeline was still logging progress). Fix:

- **`query()` retries on transient failures.** 5xx responses, 429 rate limits, and network errors → retry up to 3 attempts with exponential backoff (500ms → 1s → 2s) and ±25% jitter. 4xx non-429 + SQL errors → fail fast, no retry burn.
- **`failureCount` instance counter.** Increments once per fully-failed query. Both run-scan and revise-claim surface `d1_failure_count` in their final `done` log. Non-zero → check the `d1.query.failed` lines; something's actually wrong.
- **`onFailure` callback hook.** Consumers can register arbitrary behaviour (e.g. a web app could write failed-write records to a debug table).

Verified via [d1-retry-check.ts](../apps/worker/scripts/d1-retry-check.ts):

```
── test 1: happy path ──
success: true failureCount: 0

── test 2: 401 permanent error (should fail fast, no retries) ──
  onFailure fired. attempts: 1 status: 401
  threw after 28ms (fast = no retry loop burned)
  failureCount: 1
```

---

## Observability — pino everywhere that matters

Replaced ad-hoc `console.log(JSON.stringify(…))` + `console.error` across the production path with **pino** + **pino-pretty**:

- **Production** (`NODE_ENV=production`, i.e. inside Fly): line-delimited JSON to stdout, ISO timestamps, no pid/hostname noise, level as a name. Fly's log shipper picks it up as-is; any sink we later wire up (Axiom / BetterStack / Grafana) consumes it structured.
- **Local dev**: `pino-pretty` transport, colorized, `HH:MM:ss.l` timestamps. Readable without piping through `jq`.
- `logger.child({ scan_id, handle })` gives per-scan loggers so every line carries context automatically. Same shape for `logger.child({ src: "gh-fetcher" })` etc.

### Coverage table

| Module | Logger | Covers |
|---|---|---|
| **Entrypoints** (`run-scan.ts`, `revise-claim.ts`) | `scanLog = logger.child({ scan_id, handle })` | boot, hydrated, done (incl. `d1_failure_count`), all error paths, heartbeat/event-log failures |
| **D1 client** (`cloud/d1.ts`) | `logger.error` | query failures after retry exhaustion — sql preview, actual attempts, status |
| **R2 client** (`cloud/r2.ts`) | `r2Log = logger.child({ src: "r2" })` | hydrate success (info), upload/list/download errors with `scan_id` + `key` |
| **Fly client** (`cloud/fly.ts`) | `flyLog = logger.child({ src: "fly" })` | machine spawn (info w/ `machine_id`, `image`, `init_cmd`), destroy (info), GraphQL resolve (debug on success, error with body on failure) |
| **GitHub fetcher** (`github-fetcher.ts`) | `ghLog = logger.child({ src: "gh-fetcher" })` | transient retries with `attempt` + `backoff_ms`, terminal failures, completion summary |
| **Agent base** (`agents/base.ts`) | `agentLog = logger.child({ src: "agent" })` | transient LLM retries (was stderr-only → invisible in cloud unless `GITSHOW_DEBUG`), agent loop final failure |
| **Migration runner** (`scripts/run-migration.ts`) | `migrateLog = logger.child({ src: "migration" })` | applying, per-statement ok/failed, done — matters because it runs in CI |

### What's intentionally still `console` or `stderr`

- **[src/scan.ts](../apps/worker/src/scan.ts)** (3 calls) — interactive CLI uses chalk + clack + ora. Structured JSON would destroy the UX.
- **`process.stderr.write`** in 3 places (revise-loop's `[revise]` events, agent retry CLI subtext in `base.ts`, `scan.ts` debug stream) — documented bypasses of the CLI's stream-event filter, needed for live spinner updates.
- **Dev scripts** (spawn-test-*, scan-status, *-check) — print human-readable tables where pino-pretty mangles column alignment.

---

## CI/CD — three workflows, zero-touch after first push

- **[.github/workflows/ci.yml](../.github/workflows/ci.yml)** — `bun install --frozen-lockfile` + `bun run typecheck` on every PR and every push to main. ~13s.
- **[.github/workflows/deploy-worker.yml](../.github/workflows/deploy-worker.yml)** — fires on push to main when `apps/worker/**`, `package.json`, or `bun.lock` change. Runs `flyctl deploy -c apps/worker/fly.toml .`, then scans `flyctl machines list -j` and destroys any machine whose name doesn't start with `scan-` or `revise-` — i.e. the Fly-created "standby" zombie that accompanies every deploy. Live scan/revise machines are preserved by the name filter. ~41s.
- **[.github/workflows/migrate-d1.yml](../.github/workflows/migrate-d1.yml)** — fires when `migrations/**` changes. Runs every `.sql` file through `scripts/run-migration.ts` (the same thing used manually). All DDL uses `CREATE … IF NOT EXISTS`, so the whole thing is idempotent — safe to re-run on every push. ~17s.

Four GitHub secrets required: `FLY_API_TOKEN`, `CF_ACCOUNT_ID`, `CF_API_TOKEN`, `D1_DATABASE_ID`. Set via `gh secret set NAME --body "$(grep ^NAME apps/worker/.env | cut -d= -f2-)"`. R2 creds + `OPENROUTER_API_KEY` stay on Fly (`fly secrets set`); CI doesn't need them.

First push on 2026-04-19 ran all three green on the first try.

---

## Bug log + fixes shipped this session

| Bug | Fix |
|---|---|
| `fly deploy -c apps/worker/fly.toml .` errored with `apps/worker/apps/worker/Dockerfile not found` | `dockerfile` in fly.toml is resolved relative to the config file's dir, not the build context. Changed from `"apps/worker/Dockerfile"` → `"Dockerfile"`. |
| Fly auto-creates a "standby" app machine on every deploy that immediately crashloops because `run-scan.ts` requires `SCAN_ID` | Added `restart: { policy: "no" }` + `auto_destroy: true` in the Machines API spawn config. CI destroys any post-deploy zombies filtered by name — live scans preserved. |
| `registry.fly.io/gitshow-worker:latest` 404 even after `--build-only --image-label latest` | That flag doesn't update the app's `currentRelease` on Fly. Added `FlyClient.getCurrentImage()` via Fly GraphQL API. `resolveImage()` runs before every spawn; code works regardless of tag convention. |
| `TypeError: undefined is not a function (near '...w of workers...')` inside revise-claim | `06-workers.json` is persisted as `{outputs: WorkerOutput[], artifactsSnapshot: number}` (see `pipeline.ts` `saveWorkers`), not a bare array. Unwrapped `.outputs` before passing to sub-agents. |
| spawn-test-revise tail was picking up events from earlier buggy runs and short-circuiting on a stale `kind: "error"` | Baseline `MAX(id)` at spawn time, filter events with `id > baseline`. Negative elapsed times were the tell. |
| `claims` table CHECK constraint missed `'worker_failed'` | Dropped + recreated with the full enum (5 statuses). |
| D1 writes failing silently into `.catch()` with no signal anything was lost | Retry with backoff for transient errors; `failureCount` counter + `onFailure` hook; `d1_failure_count` surfaced in every entrypoint's `done` summary. |
| Transient LLM retries in agent base.ts were only visible via stderr → invisible in cloud unless `GITSHOW_DEBUG=1` | Added a pino warn alongside the stderr write. CLI UX unchanged; cloud logs now capture retry counts + errors structured. |
| GH CLI `console.warn` lines (retries, fetched-summary) not structured | `ghLog = logger.child({ src: "gh-fetcher" })`; rate-limit hits now show `attempt`, `backoff_ms`, `error` as fields. |
| Ad-hoc `console.log(JSON.stringify({ ts, … }))` everywhere + no pretty-print for local dev | Pino. JSON in prod, pino-pretty in dev. Child loggers per scan for auto-bound context. |
| `requireEnv` / `sleep` / `log` duplicated across 5+ files | Extracted to `src/util.ts`; one source of truth. |

---

## File layout (additions since session 3)

```
apps/worker/
  src/
    util.ts                    — shared requireEnv / sleep + configured pino logger
    cloud/
      d1.ts                    — HTTP client + retry + failureCount + onFailure; structured failure logs
      r2.ts                    — S3-compat client + hydrateToLocal; logs errors with scan_id + key
      fly.ts                   — Machines API + GraphQL image resolver + initCmd override; logs spawn/destroy with machine_id
    checkpoint.ts              — added optional onSaveFile hook; saveMeta now routes through saveFile
    pipeline.ts                — RunPipelineInput gained optional `checkpoint: ScanCheckpoint`
    github-fetcher.ts          — pino migration (retries/failures/summary structured)
    agents/base.ts             — pino warn for transient retries + error on agent-loop failure
  scripts/
    run-scan.ts                — prod entrypoint (scan): hydrate → run → finalize, graceful SIGTERM, pino child logger
    revise-claim.ts            — prod entrypoint (revise): hydrate → one sub-agent → patch R2+D1
    spawn-test-scan.ts         — local smoke of the prod scan path
    spawn-test-revise.ts       — local smoke of the prod revise path (baseline-filtered tail)
    local-revise-test.ts       — run revise-claim in-process against real R2+D1 (no Fly)
    scan-status.ts             — tail scan_events for any scan_id
    d1-check.ts                — list D1 tables
    d1-retry-check.ts          — assert retry + counter + onFailure wiring
    r2-check.ts                — R2 put/list/get round-trip
    fly-image-check.ts         — print current deployed image via GraphQL
    run-migration.ts           — apply a single .sql file to D1 via REST API (pino-logged, used in CI)
  Dockerfile                   — oven/bun:1.2-debian + git + gh CLI + NODE_ENV=production
  fly.toml                     — gitshow-worker app, iad, shared-cpu-2x/2048MB, no http_service
  .env                         — gitignored, holds all cloud creds for local dev

migrations/
  0001_init.sql                — users / accounts / sessions / scans / scan_events / claims (idempotent)

.github/workflows/
  ci.yml                       — typecheck on PR + main
  deploy-worker.yml            — fly deploy on apps/worker changes, destroys zombies (filters by name)
  migrate-d1.yml               — apply migrations on migrations/** changes
```

Typecheck clean. Deploys zero-touch. Logs structured everywhere they matter. Backend is done.

---

## For the next session — apps/web

The frontend is the remaining piece. Scope decided earlier this session:

- **Stack:** Next.js on Cloudflare Workers via OpenNext, R2 + D1 bindings, NextAuth v5 + `@auth/d1-adapter` + GitHub provider with `repo read:user user:email`.
- **Scan scope (MVP):** users can only scan their own GitHub handle (locked to OAuth login).
- **Endpoints:**
  - `POST /api/scan` — insert `scans` row, spawn Fly machine, return `{ scan_id }`
  - `GET /api/scan/:id` — return scan row + events, client polls every 2–3s
  - `POST /api/scan/:id/retry` — respawn with same `SCAN_ID`, resumes from R2
  - `PATCH /api/claims/:id` — `user_edited` → direct D1 update; `regenerate` → spawn revise-claim Fly machine
- **Frontend:** sign-in page, scan trigger, live progress (polling), ProfileCard render from D1 `claims`, per-claim revise UI.

Every backend hook the web app needs is live. The `apps/web` workspace got scaffolded and torn down in this session to keep scope tight; commit history preserves the rough shape. Fresh session will start clean.
