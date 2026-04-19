-- Fix Auth.js D1 adapter schema mismatch.
--
-- @auth/d1-adapter v0.8+ expects:
--   accounts: (id PK, userId, type, provider, providerAccountId,
--              refresh_token, access_token, expires_at, token_type,
--              scope, id_token, session_state, oauth_token_secret,
--              oauth_token)
--   sessions: (id, sessionToken PK, userId, expires)
--   verification_tokens: (identifier, token PK, expires)
--
-- Migration 0001 declared these with different primary keys / columns,
-- so the adapter's CREATE_ACCOUNT_SQL (`INSERT … VALUES (?,?,?,?,?,?,
-- ?,?,?,?,?,?,?,?)`) was failing on arity mismatch. That broke OAuth
-- sign-in silently (users inserted, accounts + sessions never linked).
--
-- Both tables are empty in prod (we confirmed: 0 rows in accounts,
-- 0 rows in sessions), so rebuild them wholesale. verification_tokens
-- is untouched for now — email sign-in isn't enabled.

DROP TABLE IF EXISTS accounts;
DROP TABLE IF EXISTS sessions;

CREATE TABLE accounts (
  id                  TEXT NOT NULL PRIMARY KEY,
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
  oauth_token_secret  TEXT,
  oauth_token         TEXT,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_accounts_userId ON accounts(userId);
CREATE INDEX idx_accounts_provider_pid ON accounts(provider, providerAccountId);

CREATE TABLE sessions (
  id            TEXT NOT NULL,
  sessionToken  TEXT NOT NULL PRIMARY KEY,
  userId        TEXT NOT NULL,
  expires       INTEGER NOT NULL,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_sessions_userId ON sessions(userId);
