# Local dev loop for `apps/web`

Fastest feedback loop when debugging auth, API routes, or the split-pane.
Uses miniflare (via `wrangler dev`) with local D1 + real OpenNext runtime
— same surface as production, zero deploy.

## One-time setup

```bash
# 1. Migrations into the local D1 sqlite at .wrangler/state/v3/d1/…
bun --filter @gitshow/web d1:local:init

# 2. Dev-time secrets
cp apps/web/.dev.vars.example apps/web/.dev.vars
# Fill in at least AUTH_SECRET, AUTH_GITHUB_ID, AUTH_GITHUB_SECRET.
# Other CF / Fly creds can stay blank unless you're testing /api/scan.

# 3. GitHub OAuth app — add a second callback URL so the same app works
#    for both prod and local:
#      https://gitshow-web.yatendra2001kumar.workers.dev/api/auth/callback/github
#      http://localhost:8787/api/auth/callback/github
#    (The OpenNext preview serves on :8787 by default.)
```

## Iteration loop

```bash
bun --filter @gitshow/web preview
# builds + runs wrangler dev at http://localhost:8787
# Ctrl-C to stop
```

Why `preview` over `dev`:

- `next dev` — fastest HMR but uses the Node runtime, not Workers; CF
  bindings (`env.DB`, `env.BUCKET`, `env.SCAN_LIVE_DO`) are stubbed via
  `initOpenNextCloudflareForDev()` but anything binding-specific (D1
  adapter, R2 reads) may behave slightly differently than prod.
- `preview` — builds with OpenNext and runs the real Workers runtime
  via miniflare. ~6s startup, full parity with prod. Always use this
  when debugging anything auth/D1/R2/DO-related.

## D1 inspection

```bash
# row counts
bun --filter @gitshow/web d1:local:query "SELECT COUNT(*) AS n FROM users"
bun --filter @gitshow/web d1:local:query "SELECT * FROM accounts LIMIT 5"

# wipe a table
bun --filter @gitshow/web d1:local:query "DELETE FROM sessions"
```

## Gotchas

- **OAuth callback host mismatch** — if GitHub's OAuth consent page
  says "The redirect_uri is not associated with this application",
  you haven't added the localhost URL to the GitHub OAuth app's
  callback list.
- **Stale session cookies** — if you switch callback hosts (prod ↔
  local), clear cookies for both origins or sessions get confused.
- **`wrangler dev` port changes** — miniflare defaults to :8787 but
  can shift if that's busy. Check the wrangler startup log and
  update the GitHub OAuth callback list if needed.
