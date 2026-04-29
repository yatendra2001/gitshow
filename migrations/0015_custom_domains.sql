-- 0015_custom_domains.sql
-- Custom domains: let a Pro user point yatendra.com or
-- portfolio.yatendra.com at their gitshow profile, with TLS provisioned
-- via Cloudflare for SaaS.
--
-- Design (see DESIGN.md + custom-domains brainstorm):
--   - One domain per user (UNIQUE on user_id) — Pro plan, easy to relax.
--   - Status state machine: pending → verifying → provisioning → active.
--     Side branches: suspended (DNS broke) and failed (terminal).
--   - Apex strategy is recorded so the daily re-check knows which
--     records to look for: cname_flatten / alias / www_redirect / null
--     (subdomain — no special handling).
--   - HMAC verification token is generated at insert time, bound to
--     (user_id, hostname) so a leaked token is useless to anyone else.
--   - cf_custom_hostname_id mirrors Cloudflare for SaaS so we can poll
--     SSL status without re-issuing API calls just to look up the id.
--   - released_hostnames tombstones disconnected domains for 30 days.
--     A new claim of a tombstoned hostname requires fresh full
--     verification — the previous owner's CNAME stays live until they
--     remove it; we don't auto-route a returning hostname to a new user.
--   - domain_events is the audit log for every state transition. Used
--     for support debugging and to spot abuse patterns.
--   - domain_rate_limits backs the per-user / per-IP throttles.
--     Buckets: add (5/hr), verify (12/hr), gemini (5/hr).
--   - provider_steps_cache stores Gemini-generated provider instructions
--     keyed by (provider, instruction_kind) for 30 days.
--
-- view_events ALTERs add served_hostname + UTM columns so the analytics
-- dashboard can split traffic by which hostname served the visit, and
-- attribute campaigns intentionally tagged via ?utm_source.

-- ─── custom_domains: the active list ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS custom_domains (
  id                   TEXT NOT NULL PRIMARY KEY,
  user_id              TEXT NOT NULL UNIQUE,            -- one per user (Pro)
  hostname             TEXT NOT NULL,                   -- punycode-normalized, lowercase
  is_apex              INTEGER NOT NULL DEFAULT 0,      -- 1 if apex (no leading subdomain)
  apex_strategy        TEXT,                            -- cname_flatten | alias | www_redirect | NULL
  status               TEXT NOT NULL
                         CHECK(status IN (
                           'pending',         -- record created, awaiting first verify
                           'verifying',       -- DNS check in progress
                           'provisioning',    -- DNS ok, CF issuing TLS
                           'active',          -- live
                           'suspended',       -- was active, broke (DNS / cert renew)
                           'failed'           -- terminal failure
                         )),
  setup_method         TEXT
                         CHECK(setup_method IN ('manual','gemini_assisted')),
  detected_provider    TEXT,                            -- 'cloudflare' | 'godaddy' | 'unknown'
  verification_token   TEXT NOT NULL,                   -- HMAC bound to user_id+hostname
  cf_custom_hostname_id TEXT,                           -- Cloudflare for SaaS hostname UUID
  cf_ssl_status        TEXT,                            -- mirror of CF for SaaS ssl.status
  cf_ssl_method        TEXT,                            -- 'http' | 'txt' | 'email'
  failure_reason       TEXT,
  last_check_at        INTEGER,                         -- last time we polled DNS / CF
  last_active_check_at INTEGER,                         -- last successful re-resolution
  created_at           INTEGER NOT NULL,
  activated_at         INTEGER,
  updated_at           INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Hostname is globally unique (case-folded — `Yatendra.COM` and
-- `yatendra.com` collapse to the same bucket).
CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_domains_hostname
  ON custom_domains(hostname);

-- Status × last_active_check_at index drives the daily re-resolution
-- cron: "give me all active domains we haven't checked in >24h".
CREATE INDEX IF NOT EXISTS idx_custom_domains_status_check
  ON custom_domains(status, last_active_check_at);

-- ─── released_hostnames: tombstone for 30 days after disconnect ─────────
--
-- Subdomain takeover protection. When a user disconnects yatendra.com,
-- it lands here with cooldown_until = now + 30 days. Re-claims of a
-- tombstoned hostname (any user, including the original owner) trigger
-- fresh full verification — no instant route restoration.

CREATE TABLE IF NOT EXISTS released_hostnames (
  hostname          TEXT NOT NULL PRIMARY KEY,
  previous_user_id  TEXT,
  released_at       INTEGER NOT NULL,
  cooldown_until    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_released_hostnames_cooldown
  ON released_hostnames(cooldown_until);

-- ─── domain_events: audit log ────────────────────────────────────────────
--
-- Every state transition writes a row. Used for support debugging
-- ("why was my domain suspended?"), security review (abuse patterns),
-- and the user-facing activity strip on the settings page.

CREATE TABLE IF NOT EXISTS domain_events (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  custom_domain_id  TEXT NOT NULL,
  user_id           TEXT NOT NULL,
  event_type        TEXT NOT NULL,                  -- created | verify_attempt | dns_verified | ssl_issued | activated | suspended | reactivated | failed | deleted | admin_takedown
  prev_status       TEXT,
  new_status        TEXT,
  actor             TEXT NOT NULL                   -- user | system | admin
                      CHECK(actor IN ('user','system','admin')),
  ip                TEXT,
  user_agent        TEXT,
  metadata_json     TEXT,
  created_at        INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_domain_events_domain
  ON domain_events(custom_domain_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_domain_events_user
  ON domain_events(user_id, created_at DESC);

-- ─── domain_rate_limits: token-bucket-ish counters ───────────────────────
--
-- bucket_key examples:
--   add:user:abc123        — 5/hour
--   verify:user:abc123     — 12/hour
--   gemini:user:abc123     — 5/hour
--   add:ip:1.2.3.4         — 20/day (signup-throttle proxy)
--
-- A simple sliding-ish window: window_start gets reset every N seconds,
-- count bumps on every action. Cleanup happens implicitly — old keys
-- die at the end of their window and get overwritten on next use.

CREATE TABLE IF NOT EXISTS domain_rate_limits (
  bucket_key   TEXT NOT NULL PRIMARY KEY,
  count        INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);

-- ─── provider_steps_cache: Gemini-generated provider instructions ────────
--
-- For unknown DNS providers (long tail), we ground a Gemini-3-flash
-- call with web search to generate exact CNAME setup steps. The
-- response is cached for 30 days keyed by (provider, instruction_kind)
-- so we burn the OpenRouter + Tavily budget once per provider, not
-- once per user.
--
-- instruction_kind: cname_subdomain | cname_apex_flatten | apex_alias
--                   | apex_url_forward | txt_verify

CREATE TABLE IF NOT EXISTS provider_steps_cache (
  cache_key         TEXT NOT NULL PRIMARY KEY,         -- sha256(provider + kind)
  provider          TEXT NOT NULL,
  instruction_kind  TEXT NOT NULL,
  steps_json        TEXT NOT NULL,                     -- {steps:[...], citations:[...], generated_at, model, tokens}
  hits              INTEGER NOT NULL DEFAULT 0,
  helpful_count     INTEGER NOT NULL DEFAULT 0,
  unhelpful_count   INTEGER NOT NULL DEFAULT 0,
  expires_at        INTEGER NOT NULL,
  created_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_provider_steps_expires
  ON provider_steps_cache(expires_at);

-- ─── view_events: per-hostname analytics columns ─────────────────────────
--
-- served_hostname: the hostname that served the visit. NULL for older
-- rows (pre-migration). For new rows: 'gitshow.io' for the canonical
-- URL, the custom hostname for custom-domain visits.
--
-- is_custom_domain: denormalized 0/1 so the dashboard's attribution card
-- can compute the split with a single GROUP BY.
--
-- utm_*: campaign attribution. Captured from the landing URL when the
-- user shares the portfolio with intentional tracking (e.g. ?utm_source=
-- linkedin-may-2026). We already canonicalize utm_source to a host (see
-- visitor.ts utmHostFromPath), but storing the raw values lets us also
-- show campaign + medium as a "where did you intentionally share?" chart.

ALTER TABLE view_events ADD COLUMN served_hostname  TEXT;
ALTER TABLE view_events ADD COLUMN is_custom_domain INTEGER NOT NULL DEFAULT 0;
ALTER TABLE view_events ADD COLUMN utm_source       TEXT;
ALTER TABLE view_events ADD COLUMN utm_medium       TEXT;
ALTER TABLE view_events ADD COLUMN utm_campaign     TEXT;

CREATE INDEX IF NOT EXISTS idx_view_events_slug_hostname
  ON view_events(slug, served_hostname, ts);
