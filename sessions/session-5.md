# Session 5 — Web app on Cloudflare, Claude-style agent UI, free-form revise

**Dates:** 2026-04-19
**Outcome:** `apps/web` is live on Cloudflare Workers via `@opennextjs/cloudflare`, dark-mode throughout, signed in via GitHub OAuth with a NextAuth v5 + D1 adapter session. The scan page is a Claude-style split-pane: a chat/revisions column on the left and a live agent stack (Plan → Chain of Thought → Reasoning → Queue → Tools → Sources → Terminal) on the right that swaps to the finished profile card on completion. Users can revise in plain English — no forced `@mention` — and watch the revise job stream inline in the chat column. Worker runs unchanged from session 4; the realtime fan-out is a dedicated Durable Object worker (`apps/realtime`) addressed from `apps/web` via `script_name`. Everything shipped to prod in this session.

---

## What shipped

### `apps/web` (Next.js 16 App Router on Cloudflare)

- Next 16 App Router built with `@opennextjs/cloudflare` 1.19+, `wrangler.jsonc` with `nodejs_compat` + `global_fetch_strictly_public`, compat date `2026-04-17`.
- **No `proxy.ts` / `middleware.ts`.** Next 16's `proxy.ts` forbids `runtime: "edge"` and OpenNext-CF can't run Node.js middleware. Deleted entirely — protected routes call `await auth()` + `redirect("/signin")` inline.
- GitHub OAuth via NextAuth v5 beta (`next-auth@5.0.0-beta.25`) + `@auth/d1-adapter`, lazy factory `NextAuth(async () => ({ adapter: D1Adapter(...), providers: [GitHub], session: { strategy: "database" }, ... }))`, reads `getCloudflareContext({ async: true }).env` at request time.
- Sign-in button does a **hand-rolled CSRF POST** (CSRF fetch → hidden form submit). `next-auth/react`'s `signIn()` did not fire on CF Workers — don't try to restore it. See [apps/web/app/signin/signin-button.tsx](apps/web/app/signin/signin-button.tsx).
- Scan page `/s/[scanId]` is the core experience: [apps/web/components/scan/split-pane.tsx](apps/web/components/scan/split-pane.tsx) grids 25% left / 75% right.
- Dashboard at `/dashboard` lists all of a user's scans with timestamps, a "New scan" call, and links into `/s/<id>`.

### Realtime worker (`apps/realtime`)

- Separate Cloudflare Worker that hosts `ScanLiveDO` (Durable Object with hibernatable WebSockets via `ctx.acceptWebSocket`).
- Two routes: `POST /scans/:id/events` (from the Fly worker; auth via `X-Gitshow-Pipeline-Secret`) and WebSocket upgrade at `/scans/:id/ws` (from the browser).
- Keeps a 200-event ring buffer per scan so a late WS connect gets a `hello` backlog frame before live events resume.
- `apps/web` references it via `do_bindings[].script_name: "gitshow-realtime"` — the DO lives in the realtime worker, not the web worker.

### UI system

- Dark theme enforced at the root: `<html lang="en" className="dark">` in [apps/web/app/layout.tsx](apps/web/app/layout.tsx). Near-black palette with warm tint, CSS-first Tailwind v4 via `@theme inline`.
- Motion primitives in [apps/web/app/globals.css](apps/web/app/globals.css): `gs-enter`, `gs-fade`, `gs-stream`, `gs-pulse`, `gs-caret`, `.gs-noise`. `prefers-reduced-motion` kills them automatically.
- **AI Elements** library in [apps/web/components/ai-elements/](apps/web/components/ai-elements/): `Plan`, `ChainOfThought`, `Reasoning`, `Queue`, `Tool`, `Sources`, `Terminal`, `Task`, `Shimmer`, `Artifact`, `Conversation`, `Message`, `PromptInput`, `Suggestion`, `HudPill`. Each is local — no dependency on Vercel's shadcn AI registry. They match the visual language of Cursor / Claude / ChatGPT agent UIs.
- The agent stack is consolidated in [apps/web/components/scan/agent-progress.tsx](apps/web/components/scan/agent-progress.tsx). It renders the whole Plan + CoT + Reasoning + Queue + Tools + Sources + Terminal column from the raw `ScanEventEnvelope[]` stream + terminal tail. Two switches:
  - `sinceAt` scopes it to events after a given timestamp (used by the inline revise view). When scoped, pending-phase rows are filtered out — otherwise the revise view re-shows all 13 scan phases as "waiting".
  - `compact` hides the Plan header (used in chat-pane context).
- `WarmUpCard` inside agent-progress covers the Fly cold-boot gap (5–20s between enter and first event) with three shimmer rows so the UI never looks dead.
- Shimmer uses `bg-clip-text text-transparent` with a moving gradient keyed on `var(--foreground)` (not `currentColor` — that becomes transparent and kills the effect).
- Profile card is a single component with `InlineMarkdown` + `ClampedProse` helpers from [apps/web/lib/inline-md.tsx](apps/web/lib/inline-md.tsx) that auto-bolds KPIs (repo slugs, percentages, star counts, numbers with units) and clamps long prose to 5 lines with a Show more toggle.

### Free-form revise

- `POST /api/revise` accepts two shapes:
  - `{ scanId, guidance }` — free-form. Server calls `classifyRevise(guidance, card)` (keyword heuristic in [apps/web/lib/classify-revise.ts](apps/web/lib/classify-revise.ts)) to pick beats (hook/number/disclosure), then fans out one Fly machine per beat in parallel. Response includes a plain-English `summary` ("Rewriting the hook and the disclosure in parallel — usually 2–6 min.") plus the `dispatched` array.
  - `{ scanId, claimId, guidance }` — targeted. One beat, one machine. Used when the user clicks a specific claim on the artifact (and by the old `@mention` path, which we left in place).
- Classifier is intentionally keyword-based, not LLM — zero added latency, easy to reason about. Upgrade path: swap `classifyRevise` for an LLM call. Interface is stable.
- All revise spawns use `initCmd: ["bun", "scripts/revise-claim.ts"]`. Image `WORKDIR` is `/app/apps/worker`, so the path is relative to that — **not** `apps/worker/scripts/...`. That bug cost an afternoon in PR [#18](https://github.com/yatendra2001/gitshow/pull/18).
- `apps/worker/scripts/revise-claim.ts` now wraps every sub-agent in a `step(stage, fn)` helper that emits `stage-start` → work → `stage-end` (+ error on throw) so the chat inline progress stays live, not silent for 6 minutes. New revise sub-stages in `phase-copy.ts`: `revise-claim`, `revise-angle`, `revise-write`, `revise-critique`, `revise-numbers`, `revise-disclosure`, `revise-save`.

### Right pane state machine

[apps/web/components/scan/progress-pane.tsx](apps/web/components/scan/progress-pane.tsx) has three hard branches keyed on scan status:

- `running` / `queued` → `RunningView` — agent stack only. Full Plan / CoT / Reasoning / Queue / Tools / Sources / Terminal.
- `succeeded` → `SucceededView` — profile card only, no agent clutter. Revise progress moves to the chat column.
- `failed` → `FailedView` — clear error + back-to-dashboard CTA.

The left pane `ChatPane` inlines `<AgentProgress sinceAt={reviseStartedAt} compact />` only while `revisePending` is true.

### Data shapes

- Shared types live in `packages/shared/src/schemas.ts` (`ProfileCard`, `CardClaim`, `Artifact`) and `packages/shared/src/events.ts` (`PipelineEvent` union + `ScanEventEnvelope` + `PIPELINE_PHASES` 13-entry tuple). Both web and worker import from `@gitshow/shared`.
- Cloud clients (`D1Client`, `R2Client`, `FlyClient`, `ScanDOClient`) also live in `packages/shared/src/cloud/` with injectable `Logger` — web uses them from `auth.ts` + `/api/revise/route.ts`, worker uses them from `scripts/run-scan.ts`.

### Migrations

- `migrations/0002_live_events.sql` — rebuilt `scan_events` with a single `data_json` column + widened `kind` enum; seeded `phase_medians` with ETA seed data.
- `migrations/0003_auth_adapter_schema.sql` — DROP/CREATE `accounts` + `sessions` to match `@auth/d1-adapter`'s 14-column INSERT contract. Earlier schema had 11 columns + composite PK; the adapter swallowed the SQL arity errors, so sign-in succeeded at GitHub but no session was ever persisted. **Both migrations applied in prod.**

### CI / CD

- `.github/workflows/deploy-web.yml` — prod-only, PR previews dropped (they orphaned a Worker per PR in the CF dashboard, see [#15](https://github.com/yatendra2001/gitshow/pull/15)).
- `.github/workflows/deploy-realtime.yml` — separate deploy for the realtime worker (its own `wrangler.jsonc`).
- `.github/workflows/ci.yml` — `web-build` job + typecheck on every push.
- `.github/workflows/migrate-d1.yml` — manual-dispatch schema apply against prod D1.
- **Bun pinned to 1.2.2** across every workflow + `apps/worker/Dockerfile`. Bun 1.2.23 (CI default) rejects lockfiles written by 1.2.2 with `lockfile had changes, but lockfile is frozen`.

---

## Architecture quick-reference

```
Browser
  │
  ├── /signin                     → NextAuth GitHub OAuth
  │    └── writes sessions + accounts to D1 (@auth/d1-adapter)
  │
  ├── /dashboard                  → lists scans for session.user.id
  │
  ├── /s/<scanId>                 → SplitPane
  │    ├── ChatPane (left, 25%)   → messages + free-form input
  │    │    └── <AgentProgress sinceAt={reviseStartedAt} compact />
  │    │         (only while revisePending)
  │    └── ProgressPane (right, 75%)
  │         ├── RunningView       → <AgentProgress />  (full)
  │         ├── SucceededView     → <ProfileCard />
  │         └── FailedView        → error card
  │
  └── /api
       ├── /scan                  → spawn Fly machine (run-scan.ts)
       ├── /revise                → classify + spawn Fly machines (revise-claim.ts)
       ├── /claims/[id]           → PATCH for in-place edits
       ├── /scan/[id]/events      → D1 backfill for useScanStream
       └── /ws/scan/[id]          → WebSocket proxy → ScanLiveDO

Fly ephemeral VM (per scan / per revise)
  │
  ├── runPipeline()   or   reviseClaim()
  │    ├── onSaveFile  → R2 PutObject
  │    └── onEvent     → dual sink:
  │         ├── D1 scan_events       (durable, backfill source)
  │         └── POST realtime worker (→ ScanLiveDO → WS broadcast)
  │
  └── auto_destroy: true, restart.policy: "no"

apps/realtime (separate CF worker, holds the DO)
  │
  ├── POST /scans/:id/events     → DO.ingest()
  └── WS   /scans/:id/ws         → DO.hello(backlog) + live frames
```

Scan progress in the browser is a **hybrid**:

1. On page load, `GET /api/scan/<id>/events?since=0` backfills history from D1.
2. Then `WS /api/ws/scan/<id>` opens for live events. The DO's `hello` frame replays up to 200 events — overlaps the D1 backfill, dedup'd by envelope id.
3. 2-second polling runs alongside as a safety net so a dropped DO publish doesn't stall the UI. See [apps/web/lib/use-scan-stream.ts](apps/web/lib/use-scan-stream.ts).

---

## Known gaps / intentional cuts

- **Revise classifier is keyword-heuristic, not LLM.** Good enough for the demo — handles "tighten the hook", "redo the numbers", "sharpen the disclosure", "@hook", "rewrite everything", etc. Upgrade when guidance gets ambiguous in the wild.
- **Only hook / number / disclosure beats are revisable.** Pattern + shipped edits go through a different path (`PATCH /api/claims/[id]` for in-place tweaks, no agent rerun). There's no pattern-rewriter or shipped-rewriter agent yet.
- **No streaming tokens in revise reasoning.** Sub-agents emit `reasoning` events at paragraph granularity, not token-level. The UI animates with `gs-stream` blur-in, which is good enough that users don't notice — but if you add a token-level stream later, Reasoning is already wired to append.
- **`ChainOfThought` narrative is inferred from `stage-start` / `stage-end` / `reasoning` events.** There's no explicit "plan step" event type on the worker side. If the pipeline ever diverges structurally, the inferred narrative can drift.
- **No E2E tests for the UI.** Verified manually in prod (the user agreed to test-on-prod after local setup friction). Don't add a local test harness without asking — the user explicitly opted out.
- **`MentionInput` is still wired up in `ChatPane`** even though free-form is the primary flow. It degrades to a plain textarea when the user doesn't type `@`, and the `@`-popover still works for users who want precise targeting. Do **not** rip it out without asking — the user explicitly wanted both paths.

---

## Things you must not do

- **Don't re-add `proxy.ts` / `middleware.ts`.** Incompatible with OpenNext-CF.
- **Don't restore `next-auth/react`'s `signIn()`.** It silently no-ops on CF Workers. Keep the hand-rolled CSRF POST.
- **Don't use `currentColor` inside `bg-clip-text`.** It renders transparent. Use `var(--foreground)` explicitly.
- **Don't add `debug: true` or verbose JSON.stringify to `auth.ts`.** Burns the CF Workers CPU budget on every request and caused dashboard hangs. Log via the `REDACT_KEYS`-aware helper only.
- **Don't bump bun past 1.2.2** without also regenerating `bun.lock` locally with the same version. Lockfile format drift breaks the Docker build.
- **Don't widen the worker Dockerfile `COPY` list without also updating `.dockerignore`.** The workspace manifests are load-bearing.
- **Don't revive `apps/worker/scripts/revise-claim.ts` as an absolute path in `initCmd`.** `WORKDIR` is `/app/apps/worker` — use `"scripts/revise-claim.ts"`.
- **Don't restore per-PR preview deploys.** They orphaned a Worker in CF per PR. If you need preview, do it locally with `wrangler dev`.

---

## Production state at end of session

- `gitshow-web` (CF Worker) — prod at `gitshow.app`, session store on D1, deploys from `main`.
- `gitshow-realtime` (CF Worker + DO) — prod, referenced by web via `script_name`.
- `gitshow-worker` (Fly Machines, Dockerized) — prod, spawned per-scan + per-revise.
- D1 `gitshow-db` — schema at migration `0003_auth_adapter_schema.sql`.
- R2 `gitshow-scans` — stores `scans/<id>/*.json` + card artifact.
- GitHub OAuth working end-to-end (sign in → dashboard → scan → profile).
- Free-form revise path live and tested via PRs [#14](https://github.com/yatendra2001/gitshow/pull/14), [#17](https://github.com/yatendra2001/gitshow/pull/17), [#18](https://github.com/yatendra2001/gitshow/pull/18).
- Inline revise progress in chat shipped in [#16](https://github.com/yatendra2001/gitshow/pull/16).

---

## Cleanup done at end of session

Removed at the user's request before writing this summary:

- `apps/web/components/scan/activity-stream.tsx`, `running-queue.tsx`, `live-sources.tsx` — orphan components from a pre-refactor attempt.
- `CostPill`, `EtaPill` from `ai-elements/context.tsx` (right-pane cost HUD was cut per user feedback).
- `ArtifactActions` from `ai-elements/artifact.tsx` (never rendered).
- `TaskItem`, `TaskFileChip` from `ai-elements/task.tsx` (not consumed — only `Task` is used).
- `ai-elements/test-results.tsx` — never imported. The `latestEvalAxes`, `latestUsage`, `reasoningFor` helpers in `use-scan-stream.ts` that fed it — likewise unused — also deleted.
- Stale `PipelineEvent` type import in `use-scan-stream.ts`.

Both `bun --filter @gitshow/web typecheck` and `bun --filter @gitshow/worker typecheck` pass after cleanup.
