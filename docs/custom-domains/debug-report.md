# Custom Domains — Debug Report

**Date:** April 29, 2026
**Feature:** Pro custom domains (PRs #171–#190)
**Result:** Shipped, working end-to-end on `yatendrakumar.com → www.yatendrakumar.com → portfolio`

This is a punch-list of everything that broke between "feature merged" and
"feature actually working" so the next person doesn't relearn it. Keep this
when refactoring or adding the next provider.

---

## Final architecture

```
Customer DNS                             gitshow.io zone (ours)
─────────────────────                    ──────────────────────────────────
www.example.com                          saas-fallback.gitshow.io
  CNAME → saas-fallback.gitshow.io  →    AAAA 100::    (Proxied, originless)
  (DNS only)                              ↓
                                         CF for SaaS pipeline
                                          - Custom Hostname registered
                                          - Cert via HTTP DCV
                                          - Fallback origin: saas-fallback.gitshow.io
                                          ↓ internal forward (TCP would fail to 100::)
                                         Worker Route */* on gitshow.io zone
                                          ↓
                                         gitshow-web Worker
                                          - Reads Host header (www.example.com)
                                          - Middleware looks up custom_domains
                                          - Rewrites to /{public_slug}
                                          - Renders portfolio
```

Apex on Cloudflare-hosted customer domains uses `www`-redirect (CNAME `www`,
Redirect Rule from apex → www). Apex on flatten-capable / ALIAS providers
points directly at `saas-fallback.gitshow.io`.

---

## Bugs and resolutions, in the order we hit them

### #1 · Edge runtime returned non-JSON 5xx (PR #174)

**Symptom:** Production preview endpoint returned silent failures; frontend
toasted "Couldn't preview. Try again."

**Root cause:** Six new API routes had `export const runtime = "edge"`. No
other handler in the codebase declares this. OpenNext on Cloudflare Workers
serves all routes through the same isolate, but Next compiles "edge"-flagged
handlers through a different bundle path that returned non-JSON on error.
Frontend's `try { await res.json() }` swallowed the actual error.

**Fix:** Removed `runtime = "edge"` from `/api/domains/*`, `/api/cron/*`,
`/api/internal/*`. Match the canonical pattern in the codebase.

### #2 · Verifier deadlock on the HTTPS probe (PR #176)

**Symptom:** Customer added correct DNS, dashboard showed "Connecting in
progress…" forever, never advanced.

**Root cause:** I gated CF for SaaS hostname registration on a probe to
`/.well-known/gitshow-probe`. But that probe can only succeed *after* CF has
issued a cert and started routing — both of which only happen *after* we
register with CF. Chicken-and-egg.

**Fix:** Reverted the probe-as-gate. Let CF be the judge: register the
hostname on lenient DNS evidence (any A/AAAA at apex, or CNAME match), then
poll CF status. If records point at the wrong host, CF returns
`ssl_status = validation_failed` and we surface that.

### #3 · Cron filter excluded `verifying`/`pending` (PR #179)

**Symptom:** When verify endpoint failed transiently (see #4), nothing
recovered the row. Manual cron triggers returned `checked: 0`.

**Root cause:** `listActiveForRecheck` filter was
`status IN ('active','provisioning','suspended')`. Stuck rows had no path
to recovery without the user re-clicking "Check now".

**Fix:** Filter now also includes `pending` and `verifying` with a fast
5-minute stale window (vs 23h for already-active). Cron also calls
`createCustomHostname` for rows missing `cf_custom_hostname_id` — the
verify endpoint isn't the only path to creation anymore.

### #4 · CF-for-SaaS Free-tier paid-feature errors (PRs #177, #181)

**Symptom:** Hostname creation failed silently in the cron path. Audit log
showed `cf_1459`, then later `cf_1413`.

**Root causes (in sequence):**

| Field sent | Tier required | CF error |
|---|---|---|
| `certificate_authority` | Enterprise | `cf_1459` |
| `bundle_method` | Enterprise | `cf_1459` |
| `settings.min_tls_version` | Pro+ | `cf_1459` |
| `custom_metadata` | Paid SSL for SaaS | `cf_1413` |
| `custom_origin_sni` | Enterprise | "Access … not granted" |

Each fix exposed the next one because the cron's catch was swallowing
errors silently (PR #180 added `console.warn` + persisted the real error
to `failure_reason`, which finally let us see them).

**Fix:** Strip the SSL config to the bare minimum CF Free accepts:
`{ ssl: { method: "http", type: "dv" } }`. CF picks sane defaults
(LE/Google CA, ubiquitous bundle, TLS 1.2+).

### #5 · Tombstone too strict (PR #184)

**Symptom:** User disconnected `yatendrakumar.com`, immediately tried to
add `www.yatendrakumar.com`, got blocked with "30-day cooldown".

**Root cause:** `isHostnameTombstoned` did exact-match by hostname, but
the API returned the cooldown without checking *which user* tombstoned
it. Same-user re-claims got blocked despite being safe.

**Fix:** Return `previous_user_id` from tombstone lookup; route
short-circuits the block when `previous_user_id === current_user_id`.
Other users still wait the 30-day cooldown (subdomain takeover defense).

### #6 · Connect button silent failures (PR #185)

**Symptom:** User clicked Connect, "loaded for 5 seconds, nothing happened."

**Root cause:** Two gaps:
- 429 / `invalid_json` error responses had no `message` field; frontend
  fell back to a generic toast.
- Network errors threw out of the `try` block entirely; nothing surfaced.

**Fix:** Every error branch returns a human `message`. 429 includes
`retryAfter`, frontend formats as "3 min 29 sec" + auto-retry button.
Wrapped fetch in catch so network failures always toast.

### #7 · Cloudflare-hosted apex: TXT pre-validation refused

**Symptom:** Apex setup with TXT pre-validation stuck at
"Pending (Error) — custom hostname does not CNAME to this zone".

**Root cause:** When the customer's domain is itself on Cloudflare AND the
hostname is the apex (with CNAME flattening), Cloudflare won't validate
ownership via TXT/HTTP because:
- TXT/HTTP validation tokens are refused for Cloudflare-hosted customer
  domains by design (cross-account security).
- Apex flattening hides the original CNAME from Cloudflare's lookup, so
  CNAME-target validation fails.
- The official fix is "Apex Proxying" — Enterprise only.

**Fix (PR #183):** For Cloudflare-hosted apex, we now default to
`www_redirect` strategy instead of `cname_flatten`:
- Customer adds `CNAME www → saas-fallback.gitshow.io` (DNS only, visible
  to CF — no flattening on `www`).
- Customer adds a Cloudflare Redirect Rule: apex → 301 → www.
- Validation passes (CF sees the literal CNAME on `www`); apex still
  serves portfolio because the redirect rule fires first.

End-user experience: typing `yatendra.com` in the URL bar → 301 → URL bar
shows `www.yatendra.com` → portfolio renders. Same as Google/Facebook/most
big sites.

### #8 · Existing A/AAAA records blocked apex CNAME

**Symptom:** Cloudflare's UI rejected adding the apex CNAME with "An A,
AAAA, or CNAME record with that host already exists."

**Root cause:** RFC 1034 §3.6.2: a CNAME at any name forbids other records
at the same name. The customer's apex still had A records pointing at a
previous portfolio host (Heroku-style 23.21.x.x).

**Fix (PR #175):** Updated the Cloudflare apex setup card to explicitly
say "If the root has any existing A or AAAA records, delete them first."
Caught at the customer onboarding step instead of confusing them in the
DNS UI.

### #9 · Cross-account CNAME (Error 1014)

**Symptom:** Browser visit to `yatendrakumar.com` returned a Cloudflare
1014 page: "CNAME Cross-User Banned."

**Root cause:** When customer's domain is on Cloudflare (account A) and
the CNAME target is on Cloudflare (account B — gitshow.io), Cloudflare
blocks the cross-account CNAME *by default* until the SaaS provider has
registered the customer's hostname via the Custom Hostnames API.

**Fix:** Confirmed with the docs that 1014 clears once `createCustomHostname`
succeeds. Issue was "create call kept failing" (see #4); once that was
green, 1014 went away.

### #10 · CF for SaaS forwarding loop → 522 (PRs #189, #190)

**Symptom:** Hostname showed Active in CF dashboard. Cert issued. But
`https://www.yatendrakumar.com` returned 522 (Connection timed out).
Worker `tail` showed the worker NEVER receiving the request.

**Root cause:** The internal forward from CF-for-SaaS pipeline to the
fallback origin was looping. Trace:
1. Customer DNS → CF anycast with SNI = www.yatendrakumar.com
2. CF for SaaS: registered hostname → terminate TLS, forward to fallback
3. Fallback was set to `cname.gitshow.io` (a real proxied hostname on our zone)
4. Internal forward: SNI defaulted to Host header (= www.yatendrakumar.com)
5. Forward lands back on CF anycast with SNI matching the same registered
   Custom Hostname
6. CF for SaaS engages again → forwards again → loop → 522

The `custom_origin_sni` setting would break the loop (forward with a
hostname-specific SNI that doesn't match any Custom Hostname), but it's
Enterprise-only.

**Fix (PR #189):** Use the documented Free-tier pattern for "Workers as
fallback origin":
- New DNS record: `saas-fallback.gitshow.io AAAA 100::` (proxied,
  *originless* — `100::` is RFC 6666 discard prefix, no real host).
- Worker Route on gitshow.io zone: pattern `*/*` → gitshow-web.
- Set CF for SaaS fallback origin to `saas-fallback.gitshow.io`.

CF can't actually establish a TCP connection to `100::` (unrouteable),
but the Worker Route intercepts at CF's routing layer *before* TCP and
dispatches directly to the worker. Host header preserved. No loop.

### #11 · Per-hostname `custom_origin_server` overrode zone fallback

**Symptom:** After setting up the originless fallback origin pattern,
www.yatendrakumar.com still 522'd.

**Root cause:** During earlier debugging the user had manually set
`custom_origin_server = cname.gitshow.io` on the per-Custom-Hostname row
in the CF dashboard. That setting takes precedence over the zone-level
fallback origin. So even though we moved the zone fallback to
`saas-fallback.gitshow.io`, the hostname was still trying to forward
to `cname.gitshow.io`.

**Fix:** Manually cleared via dashboard (radio: Default origin server,
not Custom origin server). No code change.

### #12 · Next.js `_internal` folder is private (PR #187)

**Symptom:** New `cf-inspect` debug endpoint at
`/api/_internal/cf-inspect` 404'd. Closer inspection: the existing
`/api/_internal/route-host` (used by middleware to look up
hostname → slug) was *also* 404'ing.

**Root cause:** Next.js App Router treats any folder starting with `_`
as private — excluded from routing entirely. This was a *latent* bug since
PR #171: every custom-domain request was silently 404'ing the slug
lookup, which is why the middleware's "rewrite to /not-found" was firing
even when CF for SaaS routing was correctly configured.

**Fix:** Renamed `_internal/` → `internal/`. Added an `x-internal-route`
header gate on `route-host` so the now-publicly-routable path still
isn't useful for slug enumeration.

### #13 · Middleware self-fetch loop (PR #190 — final fix)

**Symptom:** After every other fix, www.yatendrakumar.com returned a
proper Next.js 404 (proving the worker was reachable!) — but it should
have rendered the portfolio.

**Root cause:** The middleware does `fetch(${origin}/api/internal/route-host)`
for the hostname-to-slug lookup. When the original request came from a
custom domain, the inner fetch ALSO arrived with that custom domain as
Host. The middleware's "block /api/* on custom hostnames" rule (intended
to prevent leaking auth APIs to customer domains) rewrote the inner fetch
to /not-found. Result: lookup always returned `slug = null` → outer
response was /not-found 404. **Loop of one.**

**Fix:** Added `/api/internal/route-host` to the custom-domain bypass
list in middleware. The route's own `x-internal-route` header gate keeps
external callers out (defense in depth).

---

## What we ended up with

After PR #190 lands, `https://www.yatendrakumar.com` returns
`HTTP/2 200` with the portfolio HTML. `https://yatendrakumar.com` 301s
to www.

End-to-end transitions take ~30s after the customer adds DNS:
- DNS propagation: <30s on Cloudflare
- CF for SaaS hostname creation: instant
- Cert issuance via HTTP DCV: 30–90s typical
- Edge propagation: seconds

## Lessons

1. **Test the end-to-end flow as early as you can.** We had Cloudflare
   for SaaS configured for ~6 hours before discovering the worker was
   never being reached. Worker `tail` should be in the loop from
   minute one of debugging.

2. **Audit logs every error, even ones you "know" are transient.** PR #180
   adding `console.warn` + persisting `failure_reason` was the moment we
   got out of the silent-failure loop and started actually fixing things.

3. **Cloudflare's free tier hides paid features behind innocuous-looking
   API fields.** Strip the request body to the bare minimum that works,
   add fields back one at a time when you actually need them.

4. **Next.js `_underscore` folders are private — including under `app/api/`.**
   This isn't documented prominently. Burned us.

5. **CF for SaaS + Workers as origin is *officially supported*** (per
   their docs) but the recipe is non-obvious: originless DNS record +
   Worker Route. Not the "use the worker hostname as fallback origin"
   pattern that seems intuitive.

6. **A debug endpoint that calls the upstream API and returns the raw
   state was the single highest-leverage debugging tool.** When the
   in-product error said "active" but reality was 522, the inspect
   endpoint surfaced the actual `custom_origin_server`,
   `custom_origin_sni`, fallback origin status, all in one curl. Worth
   the 30 minutes to build.

## Setup checklist for new gitshow deployments

If you ever reset / need to redo this on a new zone:

**One-time on the gitshow.io zone:**
1. DNS → Add `saas-fallback` AAAA `100::` (Proxied, orange cloud)
2. SSL/TLS → Custom Hostnames → enable Cloudflare for SaaS
3. SSL/TLS → Custom Hostnames → Fallback Origin → set to `saas-fallback.gitshow.io`
4. Workers & Pages → gitshow-web → Settings → Domains & Routes →
   Add **Route**: pattern `*/*`, zone `gitshow.io`
5. Confirm `gitshow.io` itself is bound as a Custom Domain on the worker
   (it should already be — that's how the marketing site routes)

**Per customer (handled automatically by `/app/domain` flow):**
- Customer adds CNAME → `saas-fallback.gitshow.io`
- gitshow's `POST /api/domains` calls `createCustomHostname` to register
- Cron + verify endpoint poll until cert active
- Activation email fires once

Customer never needs to touch CF for SaaS or the worker config — they
just add one DNS record on their side.
