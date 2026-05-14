-- 0016_dev_brand_system.sql
--
-- Dev-brand system tables: build-in-public engine + open-to-work +
-- recruiter inbound. The big pivot from "GitShow generates a portfolio"
-- to "GitShow is the opinionated job-search system."
--
-- New surfaces this migration unlocks:
--   1. /app/voice  → paste writing samples, generate a voice profile
--   2. /app/build  → inbox of post drafts (X / LinkedIn / blog) auto-
--                    drafted from shipped commits / PRs / releases. The
--                    "your code already wrote the post" engine.
--   3. /app/hiring → open-to-work toggle, role/comp prefs, recruiter
--                    inbox aggregating contact-form submissions.
--   4. /{handle}   → public portfolio gains "open to" badge + a
--                    recruiter contact form when the user has enabled
--                    discoverability.
--
-- Design notes
-- ────────────
--   - users.discoverable already exists from 0012 (kg.sql). We keep
--     using it as the canonical "is this user open to inbound at all"
--     bit, and the new open_to_work_settings table carries the rest
--     (role, comp, location, opener prompt, contact handle).
--   - bip = "build in public" prefix on every new build-engine table
--     so they're easy to scan in d1 list / migrations review.
--   - bip_drafts has a single content_json blob keyed by platform
--     (x_thread / linkedin / blog) so we can store all variants for
--     a single source event without a per-platform table. JSON over
--     a join keeps the inbox UI render to one query.
--   - recruiter_inbound's spam_score is computed at write time by a
--     cheap heuristic + optional LLM judge. The inbox UI sorts by
--     (fit_score DESC, created_at DESC) so high-fit messages float.
--
-- Everything here is additive — no ALTERs to existing tables, no DROPs,
-- no data migration. Auto-applies on merge to main via migrate-d1.yml.

-- ─── voice samples + profile ──────────────────────────────────────────
--
-- Voice calibration is the foundation for every generated draft. User
-- pastes 2-5 pieces they've written (tweets, blog excerpts, Slack
-- messages); we keep the raw text + a structured profile derived
-- from it (tone, sentence length, emoji freq, recurring hooks).
--
-- The profile is regenerated on demand from the raw samples — never
-- mutated in-place — so the user can rerun calibration after editing
-- the samples and the profile stays consistent.

CREATE TABLE IF NOT EXISTS bip_voice_samples (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL,
  kind        TEXT NOT NULL                          -- 'tweet' | 'linkedin' | 'blog' | 'slack' | 'other'
                CHECK(kind IN ('tweet','linkedin','blog','slack','other')),
  source_url  TEXT,                                  -- optional, when the sample is a public URL
  body        TEXT NOT NULL,                         -- raw text, up to ~8000 chars enforced by API
  created_at  INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_bip_voice_samples_user
  ON bip_voice_samples(user_id, created_at DESC);

-- One profile per user, refreshed whenever samples change. Stored as
-- a single TEXT blob (JSON) because every draft prompt includes the
-- whole thing anyway — splitting fields would just force a join.
CREATE TABLE IF NOT EXISTS bip_voice_profiles (
  user_id           TEXT NOT NULL PRIMARY KEY,
  profile_json      TEXT NOT NULL,                   -- {tone, sentenceLength, emojiFreq, hooks[], vocab[], avoid[]}
  sample_count      INTEGER NOT NULL DEFAULT 0,      -- denormalized for sidebar "calibrated from N samples"
  generated_at      INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ─── audience config ─────────────────────────────────────────────────
--
-- Per-user preferences for the build-in-public engine: which platforms
-- to draft for, cadence, "min significance" before a draft is offered.

CREATE TABLE IF NOT EXISTS bip_audience_config (
  user_id            TEXT NOT NULL PRIMARY KEY,
  platforms_json     TEXT NOT NULL DEFAULT '["x_thread","linkedin","blog"]',
                                                     -- subset of x_thread | linkedin | blog | mastodon
  min_significance   INTEGER NOT NULL DEFAULT 6,     -- 1..10, threshold for auto-offered drafts
  notify_email       INTEGER NOT NULL DEFAULT 1,     -- 0/1: email on new draft
  weekly_digest      INTEGER NOT NULL DEFAULT 1,     -- 0/1: Sunday roll-up
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ─── build-in-public events ───────────────────────────────────────────
--
-- The "ship-worthy thing happened" stream. Each row is a candidate the
-- user could (and probably should) post about. Sources:
--
--   - manual          → user picked a project / repo / release from the
--                       UI and asked for a draft
--   - kg_project      → derived from the knowledge graph at scan time
--                       (a featured project, a milestone, a launch)
--   - gh_release      → from a GitHub Release (future: webhook-driven)
--   - gh_pr_merged    → a notable merged PR (future: webhook-driven)
--   - star_milestone  → repo crossed a stars threshold
--
-- The current MVP only writes 'manual' and 'kg_project' rows from the
-- web app; webhook-driven sources come in a follow-up PR.

CREATE TABLE IF NOT EXISTS bip_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       TEXT NOT NULL,
  source        TEXT NOT NULL
                  CHECK(source IN (
                    'manual','kg_project','gh_release',
                    'gh_pr_merged','star_milestone'
                  )),
  title         TEXT NOT NULL,                       -- "Shipped v1.0 of resume-pipeline"
  summary       TEXT,                                -- 1-3 sentence honest description
  url           TEXT,                                -- repo / PR / release link
  repo_full_name TEXT,                               -- e.g. "yatendra2001/gitshow"
  metadata_json TEXT,                                -- {stars,langs,commitCount,...}
  significance  INTEGER NOT NULL DEFAULT 7,          -- 1..10
  occurred_at   INTEGER NOT NULL,                    -- when the shipped thing happened (release date, merge time)
  created_at    INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_bip_events_user
  ON bip_events(user_id, occurred_at DESC);

-- ─── drafts ──────────────────────────────────────────────────────────
--
-- One row per generated draft. content_json shape:
--   {
--     x_thread: ["Tweet 1...", "Tweet 2...", ...],
--     linkedin: "Single post body...",
--     blog:     { title: "...", body_md: "..." }
--   }
-- Only the platforms the user has enabled get populated. Re-generating
-- replaces the row in place (no draft history — keeps the inbox clean).

CREATE TABLE IF NOT EXISTS bip_drafts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       TEXT NOT NULL,
  event_id      INTEGER NOT NULL,
  content_json  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'draft'
                  CHECK(status IN ('draft','dismissed','posted')),
  marked_posted_platforms TEXT,                      -- comma-separated subset of x_thread,linkedin,blog
  model         TEXT NOT NULL,                       -- e.g. "anthropic/claude-sonnet-4.6"
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  FOREIGN KEY (user_id)  REFERENCES users(id)      ON DELETE CASCADE,
  FOREIGN KEY (event_id) REFERENCES bip_events(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_bip_drafts_user
  ON bip_drafts(user_id, status, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bip_drafts_event
  ON bip_drafts(event_id);

-- ─── open-to-work settings ───────────────────────────────────────────
--
-- The user-facing "I'm open to roles like X, paying Y, in Z" config.
-- Backs the portfolio "open to" badge + the contact form intro line.
-- users.discoverable (from 0012) is the master switch — when off, the
-- badge / form are hidden regardless of what's stored here.

CREATE TABLE IF NOT EXISTS open_to_work_settings (
  user_id        TEXT NOT NULL PRIMARY KEY,
  status         TEXT NOT NULL DEFAULT 'looking'
                   CHECK(status IN ('looking','selectively','not_looking')),
  roles          TEXT,                                -- "Founding engineer · Staff backend"
  locations      TEXT,                                -- "Remote (US/EU) · NYC · SF"
  comp_min_usd   INTEGER,                             -- annual base USD, optional
  comp_max_usd   INTEGER,
  blurb          TEXT,                                -- 1-3 sentence pitch shown to recruiters
  contact_email  TEXT,                                -- where inbound is routed (defaults to session.email)
  show_comp      INTEGER NOT NULL DEFAULT 0,          -- whether to display comp range publicly
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ─── recruiter inbound ───────────────────────────────────────────────
--
-- One row per portfolio contact-form submission. spam_score is a
-- coarse 0..100 heuristic (later, optional LLM triage). fit_score is
-- a 0..100 LLM judgement against the user's open_to_work_settings;
-- the inbox sorts high-fit first.

CREATE TABLE IF NOT EXISTS recruiter_inbound (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         TEXT NOT NULL,
  from_name       TEXT NOT NULL,
  from_email      TEXT NOT NULL,
  from_company    TEXT,
  from_role       TEXT,                              -- "VP Eng · Linear"
  role_title      TEXT,                              -- the role they're pitching
  role_link       TEXT,                              -- JD URL if provided
  comp_note       TEXT,                              -- comp range text (free-form)
  location_note   TEXT,
  body            TEXT NOT NULL,                     -- the pitch / intro
  spam_score      INTEGER NOT NULL DEFAULT 0,        -- 0..100, higher = more likely spam
  fit_score       INTEGER NOT NULL DEFAULT 50,       -- 0..100, higher = better fit (default unknown)
  fit_reason      TEXT,                              -- 1-sentence LLM justification (optional)
  status          TEXT NOT NULL DEFAULT 'new'
                    CHECK(status IN ('new','read','replied','archived','spam')),
  source_hostname TEXT,                              -- which hostname served the form (canonical or custom)
  source_ip       TEXT,
  source_ua       TEXT,
  read_at         INTEGER,
  replied_at      INTEGER,
  created_at      INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_recruiter_inbound_user
  ON recruiter_inbound(user_id, status, fit_score DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recruiter_inbound_user_new
  ON recruiter_inbound(user_id, created_at DESC) WHERE status = 'new';

-- ─── per-user contact rate limit ─────────────────────────────────────
--
-- Token-bucket-ish counter to throttle the public contact endpoint per
-- (user_id, source_ip). Keeps a scraper from spamming a popular
-- portfolio. Same pattern as domain_rate_limits in 0015.

CREATE TABLE IF NOT EXISTS contact_rate_limits (
  bucket_key   TEXT NOT NULL PRIMARY KEY,            -- e.g. "contact:user:abc:ip:1.2.3.4"
  count        INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);
