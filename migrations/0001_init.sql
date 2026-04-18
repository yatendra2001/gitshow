-- GitShow D1 schema — initial migration.
--
-- NextAuth v5 (Auth.js) tables use the names @auth/d1-adapter expects.
-- Scan + claim tables use snake_case (app-owned, not adapter-owned).
-- Timestamps are unix epoch milliseconds (INTEGER) throughout.

-- ─── NextAuth / Auth.js tables ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id            TEXT NOT NULL PRIMARY KEY,
  name          TEXT,
  email         TEXT,
  emailVerified INTEGER,
  image         TEXT
);

CREATE TABLE IF NOT EXISTS accounts (
  userId              TEXT NOT NULL,
  type                TEXT NOT NULL,
  provider            TEXT NOT NULL,
  providerAccountId   TEXT NOT NULL,
  refresh_token       TEXT,
  access_token        TEXT,
  expires_at          INTEGER,
  token_type          TEXT,
  scope               TEXT,
  id_token            TEXT,
  session_state       TEXT,
  PRIMARY KEY (provider, providerAccountId),
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_accounts_userId ON accounts(userId);

CREATE TABLE IF NOT EXISTS sessions (
  sessionToken TEXT NOT NULL PRIMARY KEY,
  userId       TEXT NOT NULL,
  expires      INTEGER NOT NULL,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_userId ON sessions(userId);

CREATE TABLE IF NOT EXISTS verification_tokens (
  identifier TEXT NOT NULL,
  token      TEXT NOT NULL,
  expires    INTEGER NOT NULL,
  PRIMARY KEY (identifier, token)
);

-- ─── App tables ────────────────────────────────────────────────────────────

-- One row per scan. D1 is the source of truth for status and progress;
-- stage file blobs live in R2 at scans/<id>/<filename>.
CREATE TABLE IF NOT EXISTS scans (
  id                   TEXT PRIMARY KEY,
  user_id              TEXT NOT NULL,
  handle               TEXT NOT NULL,
  session_id           TEXT NOT NULL,
  model                TEXT NOT NULL,
  status               TEXT NOT NULL
                         CHECK(status IN ('queued','running','succeeded','failed','cancelled')),
  current_phase        TEXT,
  last_completed_phase TEXT,
  fly_machine_id       TEXT,
  last_heartbeat       INTEGER,
  error                TEXT,
  cost_cents           INTEGER NOT NULL DEFAULT 0,
  llm_calls            INTEGER NOT NULL DEFAULT 0,
  hook_similarity      REAL,
  hiring_verdict       TEXT,
  hiring_score         INTEGER,
  socials_json         TEXT,
  context_notes        TEXT,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,
  completed_at         INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_scans_user_id ON scans(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scans_status ON scans(status);

-- Append-only per-stage progress log. Frontend polls the tail of this
-- (filtered by scan_id) to render the live progress view.
CREATE TABLE IF NOT EXISTS scan_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id     TEXT NOT NULL,
  kind        TEXT NOT NULL
                CHECK(kind IN ('stage-start','stage-end','stage-warn','worker-update','error')),
  stage       TEXT,
  worker      TEXT,
  status      TEXT,
  duration_ms INTEGER,
  message     TEXT,
  at          INTEGER NOT NULL,
  FOREIGN KEY (scan_id) REFERENCES scans(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_scan_events_scan_id ON scan_events(scan_id, at);

-- One row per user-visible claim. Populated at the end of the scan from
-- 13-profile.json. Revisions PATCH text/status here without re-running the
-- full pipeline.
CREATE TABLE IF NOT EXISTS claims (
  id            TEXT PRIMARY KEY,
  scan_id       TEXT NOT NULL,
  beat          TEXT NOT NULL,
  idx           INTEGER NOT NULL,
  text          TEXT NOT NULL,
  label         TEXT,
  sublabel      TEXT,
  evidence_ids  TEXT NOT NULL,
  confidence    TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'ai_draft'
                  CHECK(status IN ('ai_draft','user_approved','user_edited','user_rejected','worker_failed')),
  original_text TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  FOREIGN KEY (scan_id) REFERENCES scans(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_claims_scan_id ON claims(scan_id);
