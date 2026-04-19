-- M1 foundation migration: structured streaming, two-way conversations,
-- notifications, intake flow, and the single-person user_profiles concept.
--
-- Everything here is additive. Existing scans/claims/events keep working.
-- New event kinds land alongside the current ones in scan_events.

-- ─── scan_events: widen kind, add parent_id + message_id ──────────────────
--
-- Widens the CHECK constraint to include every kind in packages/shared/
-- src/events.ts PERSISTED_KINDS. Also adds parent_id and message_id
-- columns (nullable, backfilled as NULL) so the UI can scope reasoning
-- deltas, tool cards, and sources under their parent reasoning block
-- and under the user's revise/answer bubble.

CREATE TABLE IF NOT EXISTS scan_events_v3 (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id      TEXT NOT NULL,
  kind         TEXT NOT NULL
                 CHECK(kind IN (
                   'stage-start','stage-end','stage-warn',
                   'worker-update','error',
                   'reasoning','reasoning-delta','reasoning-end',
                   'tool-start','tool-end',
                   'source-added',
                   'kpi-preview',
                   'agent-question','agent-answer',
                   'alternate-surfaced',
                   'control-ack',
                   'revise-applied',
                   'message-start','message-end',
                   'test-result','eval-axes','usage','plan'
                 )),
  stage        TEXT,
  worker       TEXT,
  status       TEXT,
  duration_ms  INTEGER,
  message      TEXT,
  data_json    TEXT,
  parent_id    TEXT,
  message_id   TEXT,
  at           INTEGER NOT NULL,
  FOREIGN KEY (scan_id) REFERENCES scans(id) ON DELETE CASCADE
);

INSERT INTO scan_events_v3
  (id, scan_id, kind, stage, worker, status, duration_ms, message, data_json, parent_id, message_id, at)
SELECT
  id, scan_id, kind, stage, worker, status, duration_ms, message, data_json, NULL, NULL, at
FROM scan_events;

DROP TABLE scan_events;
ALTER TABLE scan_events_v3 RENAME TO scan_events;

CREATE INDEX IF NOT EXISTS idx_scan_events_scan_id     ON scan_events(scan_id, at);
CREATE INDEX IF NOT EXISTS idx_scan_events_scan_id_id  ON scan_events(scan_id, id);
CREATE INDEX IF NOT EXISTS idx_scan_events_message_id  ON scan_events(message_id) WHERE message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scan_events_parent_id   ON scan_events(parent_id)  WHERE parent_id  IS NOT NULL;

-- ─── user_profiles: one living profile per user ──────────────────────────
--
-- gitshow is a single-person app. Each authenticated user owns exactly
-- one living profile, keyed by their GitHub handle. Multiple scans may
-- contribute to it over time; the "current" profile JSON is what gets
-- served at gitshow.io/{handle}.
--
-- public_slug is normally the lowercased handle but can differ if the
-- user ever changes their handle on GitHub (we preserve the old slug).

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id                TEXT NOT NULL PRIMARY KEY,
  handle                 TEXT NOT NULL,
  public_slug            TEXT NOT NULL UNIQUE,
  current_scan_id        TEXT,
  current_profile_r2_key TEXT,
  first_scan_at          INTEGER,
  last_scan_at           INTEGER,
  revision_count         INTEGER NOT NULL DEFAULT 0,
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL,
  FOREIGN KEY (user_id)         REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (current_scan_id) REFERENCES scans(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_user_profiles_handle      ON user_profiles(handle);
CREATE INDEX IF NOT EXISTS idx_user_profiles_public_slug ON user_profiles(public_slug);

-- ─── messages: user-initiated turns ──────────────────────────────────────
--
-- Every user action that the pipeline should respond to gets a message
-- row: the initial scan, each revise, each answer to an agent question.
-- `parent_id` links a revise/answer to the scan or question it belongs
-- to, so the UI can render inline progress under the right bubble.

CREATE TABLE IF NOT EXISTS messages (
  id          TEXT NOT NULL PRIMARY KEY,
  user_id     TEXT NOT NULL,
  scan_id     TEXT,
  kind        TEXT NOT NULL
                CHECK(kind IN ('scan','revise','answer','intake')),
  parent_id   TEXT,
  body        TEXT,
  image_r2_keys TEXT,
  status      TEXT NOT NULL DEFAULT 'pending'
                CHECK(status IN ('pending','running','applied','cancelled','failed')),
  preview     TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (scan_id) REFERENCES scans(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_messages_user_id   ON messages(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_scan_id   ON messages(scan_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_parent_id ON messages(parent_id) WHERE parent_id IS NOT NULL;

-- ─── agent_questions + agent_answers: two-way conversation ──────────────
--
-- The worker writes a row to agent_questions and emits an agent-question
-- event. The web layer dispatches email + desktop push + in-app inbox.
-- When the user answers (or the timeout expires), agent_answers gets a
-- row and the worker (which polls this table every ~2s) unblocks.

CREATE TABLE IF NOT EXISTS agent_questions (
  id               TEXT NOT NULL PRIMARY KEY,
  scan_id          TEXT NOT NULL,
  message_id       TEXT,
  stage            TEXT NOT NULL,
  question         TEXT NOT NULL,
  options_json     TEXT,
  default_answer   TEXT,
  timeout_ms       INTEGER NOT NULL,
  asked_at         INTEGER NOT NULL,
  expires_at       INTEGER NOT NULL,
  notified_at      INTEGER,
  FOREIGN KEY (scan_id) REFERENCES scans(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_agent_questions_scan_id    ON agent_questions(scan_id, asked_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_questions_expires_at ON agent_questions(expires_at);

CREATE TABLE IF NOT EXISTS agent_answers (
  question_id   TEXT NOT NULL PRIMARY KEY,
  answer        TEXT,
  source        TEXT NOT NULL
                  CHECK(source IN ('user','timeout-default')),
  answered_at   INTEGER NOT NULL,
  FOREIGN KEY (question_id) REFERENCES agent_questions(id) ON DELETE CASCADE
);

-- ─── scan_controls: user-issued stops, skips ─────────────────────────────
--
-- Workers poll this table every ~2s. Server-to-server polling is fine
-- (cheap, tiny payloads) even though we killed browser polling.

CREATE TABLE IF NOT EXISTS scan_controls (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id      TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  action       TEXT NOT NULL
                 CHECK(action IN ('stop','skip-stage')),
  target_stage TEXT,
  note         TEXT,
  created_at   INTEGER NOT NULL,
  acked_at     INTEGER,
  FOREIGN KEY (scan_id) REFERENCES scans(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_scan_controls_pending ON scan_controls(scan_id, acked_at) WHERE acked_at IS NULL;

-- ─── notifications: in-app inbox ─────────────────────────────────────────
--
-- Persistent list of everything the user may have missed while the tab
-- was closed. Mirrors what was sent via email + desktop push.

CREATE TABLE IF NOT EXISTS notifications (
  id           TEXT NOT NULL PRIMARY KEY,
  user_id      TEXT NOT NULL,
  kind         TEXT NOT NULL
                 CHECK(kind IN (
                   'scan-complete','scan-failed','scan-cancelled',
                   'agent-question','revise-applied','intake-ready'
                 )),
  scan_id      TEXT,
  title        TEXT NOT NULL,
  body         TEXT,
  action_url   TEXT,
  payload_json TEXT,
  read_at      INTEGER,
  email_sent_at INTEGER,
  push_sent_at  INTEGER,
  created_at   INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (scan_id) REFERENCES scans(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, read_at, created_at DESC);

-- ─── push_subscriptions: Web Push endpoints ──────────────────────────────

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      TEXT NOT NULL,
  endpoint     TEXT NOT NULL,
  p256dh       TEXT NOT NULL,
  auth_token   TEXT NOT NULL,
  user_agent   TEXT,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER,
  failed_count INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (user_id, endpoint)
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id);

-- ─── intake_sessions: pre-scan light scan + generated questions ─────────
--
-- Before kicking off the 40-50 min full scan, we run a 2-minute pre-scan
-- that reads the user's bio, top repos, and recent PRs, then generates
-- 3-5 targeted questions. Answers become context for the full scan.
--
-- status flow:
--   pending  → running  → awaiting_answers  → ready  → consumed
--                                             \\_____ abandoned

CREATE TABLE IF NOT EXISTS intake_sessions (
  id                  TEXT NOT NULL PRIMARY KEY,
  user_id             TEXT NOT NULL,
  handle              TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK(status IN ('pending','running','awaiting_answers','ready','consumed','abandoned','failed')),
  pre_scan_r2_key     TEXT,
  questions_json      TEXT,
  answers_json        TEXT,
  scan_id             TEXT,
  error               TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  completed_at        INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (scan_id) REFERENCES scans(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_intake_sessions_user_id ON intake_sessions(user_id, created_at DESC);
