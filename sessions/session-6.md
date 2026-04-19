# Session 6 — M1 → M5 streaming rewrite

Five stacked PRs. Each ships an independent, shippable chunk of the
brainstorm plan. Merge in order: M1 → M2 → M3 → M4 → M5. After M1
lands, the rest rebase onto main cleanly.

## PR stack

| # | Milestone | What it ships |
|---|---|---|
| [#20](https://github.com/yatendra2001/gitshow/pull/20) | M1 Foundation | Structured events, pure-WS streaming, D1 migration 0004, humanized labels, notification core (in-app + Resend + Web Push scaffold), intake flow (pre-scan + 3-5 questions). |
| [#21](https://github.com/yatendra2001/gitshow/pull/21) | M2 Lean profile | `/{handle}` public SSR page, shadcn chart primitives, 3 KPI + 3 insight cap, shipped strip, evidence drawer. |
| [#22](https://github.com/yatendra2001/gitshow/pull/22) | M3 Agency | Stop button + control poller, agent-question protocol (email-dispatched, 30-min timeout), critic verdict card. |
| [#23](https://github.com/yatendra2001/gitshow/pull/23) | M4 Revise | Composer rewrite (no mentions, screenshot attach, paste/drag), `/api/revise/upload`, `messages` row scoping, inline progress under bubble. |
| [#24](https://github.com/yatendra2001/gitshow/pull/24) | M5 Polish | Export (`/api/export/[handle]?format=html\|json`), refresh (24h cooldown), privacy drawer + delete-everything endpoint. |

## Deployment order (do this once, top to bottom)

### 1. Apply D1 migration 0004 (new tables + widened CHECK)

```bash
cd apps/web
bun run d1:local:init                  # local dev
# or for prod — wrangler secret of your CF API token needed
wrangler d1 execute gitshow-db --file=../../migrations/0004_m1_foundation.sql --remote
```

The migration is additive (widens `scan_events.kind`, adds
`parent_id` and `message_id` columns, creates 8 new tables). Existing
rows are preserved. Safe to run before any of the new code deploys.

### 2. Set the new env vars

All are **optional** — a missing key just no-ops the affected channel.

| Env | Purpose | Required? | Where |
|---|---|---|---|
| `RESEND_API_KEY` | Email delivery (scan-complete, scan-failed, agent-question) | No (recommended for 40-50 min scans) | Both web worker and Fly machine |
| `EMAIL_FROM` | Sender identity. Default `gitshow <noreply@gitshow.io>` | No | Same as above |
| `VAPID_PUBLIC_KEY` | Exposed to the client; identifies this app to the browser push service | No (Web Push disabled without it) | Web worker only |
| `VAPID_PRIVATE_KEY` | Signs outbound pushes | No | Whoever sends — currently unsigned (sender is the next follow-up) |
| `PUBLIC_APP_URL` | Base URL for deep links in emails. Default `https://gitshow.io` | No | Web worker + Fly machine |

Set them via wrangler for the web worker:

```bash
cd apps/web
wrangler secret put RESEND_API_KEY          # paste when prompted
wrangler secret put VAPID_PUBLIC_KEY
wrangler secret put VAPID_PRIVATE_KEY
wrangler secret put EMAIL_FROM              # e.g. "gitshow <hello@yourdomain.com>"
wrangler secret put PUBLIC_APP_URL          # e.g. "https://gitshow.io"
```

For the Fly worker (runs the scan pipeline), the web API route
auto-forwards these when spawning machines — no separate Fly
secrets needed **as long as** the web worker has them. If you ever
run the Fly worker out-of-band (e.g. manual CLI scan), add them to
the Fly app secrets too:

```bash
fly secrets set -a gitshow-worker \
  RESEND_API_KEY=re_xxx \
  PUBLIC_APP_URL=https://gitshow.io
```

### 3. Generate VAPID keys (once, ever)

The cheapest path is the `web-push` CLI. Install it transiently:

```bash
bunx web-push generate-vapid-keys
# prints:
#   Public Key:  BNxxxxxx... (url-safe base64, 65 bytes)
#   Private Key: xxxxxx...   (url-safe base64, 32 bytes)
```

Save the public key as `VAPID_PUBLIC_KEY`, private as
`VAPID_PRIVATE_KEY`. **Never rotate** unless you're OK with every
subscribed browser getting a silent error on next push — they'll
resubscribe at their next visit.

### 4. Resend setup

1. Create an account at [resend.com](https://resend.com).
2. Verify your sending domain (add DKIM + SPF). Without this, emails
   land in spam. A `from` on an unverified domain will 403.
3. Create an API key, set as `RESEND_API_KEY` (starts with `re_`).
4. Test with `curl -X POST https://api.resend.com/emails ...` or
   trigger a scan-complete.

Cost note: free tier covers 3k emails/month — more than enough for
single-person usage. You're NEVER going to hit rate limits from
gitshow because one scan fires one email.

### 5. Register the service worker on the web root

The `/sw.js` file is already at `apps/web/public/sw.js`. Next.js
serves it at the origin root automatically. Verify after deploy:

```bash
curl -s https://gitshow.io/sw.js | head -20
# should return the JS
```

The `<PushEnableButton />` component registers it on first click.

### 6. Point `user_profiles` at the CDN

Add a Cache-Control header on `/{handle}` for CDN caching (optional
but recommended — removes origin load on shares). Either in
`next.config.ts` or the route:

```ts
// apps/web/app/[handle]/page.tsx
export const revalidate = 60; // or use fetch-cache with tags
```

(Left off the PR intentionally — revalidation strategy depends on
how aggressive you want shares to look. 60s is a safe default.)

## Verification checklist

After merging everything, run through this end-to-end:

- [ ] **Streaming** — start a scan, DevTools Network tab shows **zero**
      XHR/fetch polls. Only a WS connection to `/api/ws/scan/[id]`
      and one initial GET to `/api/scan/[id]/events?since=0`.
- [ ] **Reconnect** — disable your network for 30s, re-enable. WS
      reconnects and the client catches up with a `subscribe` frame;
      no events are lost.
- [ ] **Notifications** — scan completes → notification bell shows
      unread badge. If `RESEND_API_KEY` is set, email arrives within
      a minute. Clicking the notification deep-links to `/{handle}`.
- [ ] **Public profile** — visit `gitshow.io/{your_handle}`
      unauthenticated (incognito). Lean card renders. Share button
      uses native share on mobile.
- [ ] **Stop** — mid-scan, click Stop → confirm → scan goes to
      `cancelled` state within 2s (control-ack event fires).
- [ ] **Intake** — new-user path: `/app` → `/app/intake/{id}` with
      shimmer → 3-5 questions → answering → redirect to `/s/{scanId}`
      with `context_notes` threaded through.
- [ ] **Revise** — on the workspace, attach a PNG + type "tighten the
      hook" → send → inline progress shows reasoning/tools/sources
      grouped under your bubble → collapses to "Applied · 1 change".
- [ ] **Export** — `gitshow.io/api/export/{handle}?format=html` →
      browser renders a print-ready page → Cmd+P → Save as PDF.
- [ ] **Privacy** — drawer lists what's collected; delete button
      takes two clicks to confirm; POST succeeds; next login is
      fresh.

## Known limitations (follow-up items)

- **Web Push delivery** — the scaffold is complete (VAPID endpoint,
  subscribe, service worker, enable button, DB storage). The
  *sender* side (reading `push_subscriptions`, signing with VAPID
  private key, POSTing to push services) is not yet wired into
  run-scan.ts. Small follow-up: add a `sendPushNotification()`
  helper that mirrors the Resend send and fire it in parallel on
  scan-complete / agent-question.

- **Worker reads IMAGE_R2_KEYS** — /api/revise threads them into the
  Fly machine env but `revise-claim.ts` doesn't read them yet. Add
  a block in the revise agent's input builder that pulls each key
  from R2 and adds it as a vision content block. Sonnet 4.6
  accepts base64 images up to 5MB each, so the upload limit already
  matches.

- **ARIA live regions** on the streaming chain-of-thought — worth a
  focused a11y pass. Add `role="status" aria-live="polite"` around
  the active reasoning block; matching off-screen text for
  structural changes.

- **Per-word diff on revise output** — the `revise-applied` event
  already carries `before` and `after` pairs; a client-side diff
  (e.g. jsdiff) would render the highlight. Not shipped in M4 but
  all the data is there.

- **Scroll lock / "Jump to current"** — standard chat behavior.
  Trivial to add once the scan page adopts the new event-stream
  structure consistently.

## Architecture invariants (don't regress these)

- **Browser never polls**. One WS + one-shot backfills on reconnect.
- **Worker polls D1 for controls + answers** every 2s. Server-to-
  server is cheap, keeps the control plane simple.
- **Every emitted event flows through D1 + DO ring buffer**. D1 is
  durable; DO is fast fan-out; client dedupes by envelope `id`.
- **Cost is never surfaced to the user.** No `cost_cents`, no token
  counts, no "projected spend" in the UI. Internal telemetry only.
- **Single-person app.** One `user_profiles` row per user, keyed by
  `user_id`. `public_slug = handle.toLowerCase()`. Route
  `/{handle}` is the product's face.
