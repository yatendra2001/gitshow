# Session 7 — post-M5 stabilization + scan-page UX

M1 → M5 is live. This session was entirely **iteration on the live
surface** — fixing regressions the user caught inside a real scan,
then rebuilding the scan view around the structured event stream we
built in M1. All work is merged to main and deployed (web version
`a4ad328f`, realtime `f7c52d63`, Fly image `01KPM6NHHERS5SBPJQW9DZGMNV`).

## What shipped

| PR | Scope |
|---|---|
| [#25](https://github.com/yatendra2001/gitshow/pull/25) | Single-person `/app` landing. Old `/dashboard` scan-list is gone; legacy URL permanently redirects. Cost / LLM-call counts removed from the UI entirely. |
| [#26](https://github.com/yatendra2001/gitshow/pull/26) | Capture the GitHub login on sign-in. Auth.js's default adapter stored only display name, so the page said "Yatendra Kumar" instead of "@yatendra2001". Added migration `0005_users_login.sql`, `signIn` + `session` callbacks to populate/expose the column, and widened `authorized()` to gate `/app`. |
| [#27](https://github.com/yatendra2001/gitshow/pull/27) | Private + org repo access restored. Every Fly spawn now forwards the user's OAuth access_token (from `accounts.access_token`) as `GH_TOKEN` instead of the shared bot token. Privacy drawer rewritten to match reality. Intake LoadingState gets elapsed timer + rotating copy + stuck-state card. |
| [#28](https://github.com/yatendra2001/gitshow/pull/28) | `emit` plumbed through every leaf agent (6 workers, hook trio, numbers, disclosure, shipped, copy-editor, profile-critic, hiring-manager, timeline). Connection state + last-event ticker pills on the scan HUD. |
| direct-commits | revise-loop + stability-check also plumb emit; `/api/ws/scan/[id]` bypassed — client connects **direct** to the realtime worker because OpenNext drops the `webSocket` field on `Response`. |
| direct-commits | **Scan page rewrite**: nested per-phase rendering. Queue of phase cards; running phase auto-opens; each shows `<Reasoning>` / `<Tool>` / `<Sources>` blocks nested inside. Terminal collapsed behind a "Developer log" toggle. |
| direct-commits | Reasoning renders markdown. Had to ditch `streamdown` (its react-markdown + remark + rehype deps blew the Cloudflare 3 MiB free-tier limit) — wrote a ~150-line tailored parser in `reasoning.tsx` covering bold / italic / code / lists / headings / blockquotes / links / fenced code. Font switched from serif to sans `[13px]/1.65`. |
| direct-commits | Auto-transition to profile on `done` frame (no reload). Scan history drawer under the finished card. Classifier-revise returns `{ ok: false; error }` with honest messages for `pattern` / `shipped` / no-match instead of silently defaulting to `hook`. |

## Architecture state

Same invariants as session-6 still hold, plus:

- **Browser WS connects direct to `gitshow-realtime.<subdomain>.workers.dev`** — not through `gitshow-web/api/ws/*`. OpenNext's WebSocket upgrade proxy is broken. This bypass is an MVP concession; scan_ids are 10-char nanoids so public addressability is safe but a signed-URL gate is the long-term correct answer.
- **Cost is never rendered.** Bell, inbox, profile page, scan page, dashboard — nothing displays cents or token counts.
- **`/dashboard` permanently redirects to `/app`.** Single-person model; old bookmarks still work.
- **Cloudflare free-tier 3 MiB Worker size** is the real constraint on client deps. `streamdown` / `react-markdown` / heavy libraries must be evaluated against this. Tiny purpose-built parsers beat pulling in the whole ecosystem.

## Known issues / what's next (UI-focused)

Ranked rough priority:

1. **Developer log still gets the raw agent stderr.** The OpenRouter SDK `onProgress(text)` dumps per-token prose into `stream` events that feed the Terminal. That's fine when collapsed, but cleaning the raw-text channel and relying purely on structured events would let us hide the Terminal entirely.

2. **Reasoning blocks aren't per-agent-titled when a phase contains multiple agents.** The hook stage runs angle-selector → writer → critic — currently they render as three separate Reasoning blocks with `label="Thinking"`. Should be `Picking the angle` / `Drafting openers` / `Scoring drafts` derived from the `agent` field.

3. **Tool cards show worker-updates (cross-repo / temporal / etc) as "tools".** Works but conceptually fuzzy — workers are parent agents, not tool calls. Either rename the card or split into a "Sub-agents" section.

4. **Sources chips have no preview-on-hover.** `source-added` events carry a `preview` string; the chip should show it in a tooltip (and eventually open the evidence drawer with the full artifact). Currently just a label.

5. **Mobile layout for /s/[scanId] is untested.** The split-pane is a hardcoded 25/75 grid. On narrow screens it breaks.

6. **Revise composer rewrite from M4 isn't wired into /s/[scanId].** The component exists (`components/revise/composer.tsx`) but split-pane still uses the old `MentionInput`. Swap once the scan view feels stable.

7. **Classifier's "I can't tell what you meant" error should surface the suggestion chips inline** — currently just the message text lands as an assistant bubble. The 422 payload already includes `suggestions[]`; wire them as clickable chips under the error.

8. **Phase-queue pending rows look dim-but-uniform.** Adding duration estimates ("usually ~5 min" from `phase_medians`) would make the queue feel alive even before a phase starts.

9. **Empty-state auto-scroll.** When the list of phase cards grows past viewport, the running phase should auto-scroll into view (like chatbot's scroll-to-bottom on new message).

10. **Light-mode pass.** Everything's tuned for dark mode; light theme is technically correct via tokens but the visual rhythm was never critiqued.

## Useful pointers for next session

- Phase card component: `apps/web/components/scan/agent-progress.tsx` — `PhaseCard` + `buildPhaseTree()`. One file; no external state.
- Reasoning primitive: `apps/web/components/ai-elements/reasoning.tsx` — self-contained markdown parser at the bottom.
- Events contract: `packages/shared/src/events.ts`. Any new field needs server-side emit + client-side rendering; schema is backward-compatible (additive union).
- Realtime DO: `apps/realtime/src/index.ts`. Ping interval 20s via DO alarm. Ring buffer 200 events.
- Classifier: `apps/web/lib/classify-revise.ts`. Keyword union recognizes pattern/shipped as "not revisable yet" instead of silently defaulting to hook.
- Scan page route: `apps/web/app/s/[scanId]/page.tsx` → `<SplitPane>` → `<ProgressPane>` + `<ChatPane>`.
