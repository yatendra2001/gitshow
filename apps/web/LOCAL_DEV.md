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

## Dodo Payments (billing)

Billing uses [Dodo Payments](https://app.dodopayments.com) via the
`@dodopayments/better-auth` plugin. Subscription state lives in the
local `subscription` D1 table, populated by the plugin's auto-mounted
webhook at `/api/auth/dodopayments/webhooks`.

### One-time dashboard setup

1. **Products** — Dashboard → Products → Create Product:
   - `Pro Monthly` — subscription, $20/mo
   - `Pro Yearly` — subscription, $144/yr (40% discount vs. $240)
   - Copy each `prod_xxx` id into `.dev.vars`.
2. **API key** — Dashboard → Developer → API → create a **test-mode**
   key (`sk_test_…`). Paste into `DODO_PAYMENTS_API_KEY`.
3. **Webhook endpoint** — Dashboard → Developer → Webhooks → Create:
   - URL: `https://<ngrok-host>/api/auth/dodopayments/webhooks`
     (Dodo can't reach `localhost`; tunnel via `ngrok http 8787`.)
   - Subscribe to all `subscription.*` events (active, updated,
     on_hold, renewed, plan_changed, cancelled, failed, expired).
   - Copy the signing secret into `DODO_PAYMENTS_WEBHOOK_SECRET`.

### Local test loop

```bash
# Terminal 1
bun --filter @gitshow/web preview

# Terminal 2 — expose the preview so Dodo webhooks reach us
ngrok http 8787
# Update the webhook URL in the Dodo dashboard to the ngrok origin
# every time ngrok restarts (the free tier rotates subdomains).
```

Then:

1. Sign in at `http://localhost:8787` — the Dodo plugin's
   `createCustomerOnSignUp` provisions a Dodo customer with
   `metadata.userId = <d1 user id>`.
2. Visit `/pricing` → pick Monthly/Yearly → redirected to Dodo's
   hosted checkout. Use test card `4242 4242 4242 4242` (any future
   expiry, any CVC).
3. On success, Dodo fires `subscription.active` → our webhook sync
   writes a row into `subscription`. Verify with:
   ```bash
   bun --filter @gitshow/web d1:local:query \
     "SELECT id, status, current_period_end FROM subscription"
   ```
4. `/app/billing` should now show the plan; `/app` unlocks the full
   dashboard; `/pricing` auto-flips into "manage" mode.

### Flipping to production

- In `wrangler.jsonc`, change `DODO_PAYMENTS_ENVIRONMENT` from
  `"test_mode"` to `"live_mode"`.
- Replace the test API key + webhook secret with live-mode values
  via `wrangler secret put DODO_PAYMENTS_API_KEY` /
  `DODO_PAYMENTS_WEBHOOK_SECRET`.
- Point the Dodo webhook at the deployed worker URL (no ngrok).

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
