-- Swap the auth backend from Auth.js (@auth/d1-adapter) → Better Auth.
--
-- Why: Auth.js v5's REST signout requires a CSRF token the UI wasn't
-- sending, so "Sign out" silently failed and users stayed logged in.
-- Better Auth ships clean cookie-based sessions, a well-behaved
-- `authClient.signOut()`, a first-class Stripe plugin for what's next,
-- and a D1-native adapter via `better-auth-cloudflare` (`d1Native`
-- path — no drizzle).
--
-- Strategy: keep the `users` table (so scans/profiles/messages rows
-- keep pointing at the same user_id), drop the three Auth.js-specific
-- tables wholesale, and create Better Auth's singular `account`,
-- `session`, `verification` tables from its published schema.
-- `users` is mapped via `user.modelName = "users"` in auth.ts.
--
-- Data impact: existing `accounts`/`sessions`/`verification_tokens`
-- rows are wiped. Users must re-sign-in through GitHub OAuth; Better
-- Auth's account linking will match by verified email and reuse the
-- existing `users.id`, so downstream app data (scans, user_profiles,
-- notifications, push_subscriptions, etc.) stays tied to the same
-- user record.

-- ─── users: add Better Auth's required timestamp columns ──────────────────
--
-- Better Auth's default user schema includes `createdAt` + `updatedAt`
-- (epoch-ms INTEGERs in SQLite). Existing users table didn't have them.
-- Backfill with "now" for pre-existing rows so we don't trip NOT NULL
-- once the adapter takes over.

ALTER TABLE users ADD COLUMN createdAt INTEGER;
ALTER TABLE users ADD COLUMN updatedAt INTEGER;

UPDATE users
   SET createdAt = COALESCE(createdAt, CAST(strftime('%s','now') AS INTEGER) * 1000),
       updatedAt = COALESCE(updatedAt, CAST(strftime('%s','now') AS INTEGER) * 1000);

-- ─── Drop Auth.js tables (incompatible schemas) ──────────────────────────

DROP TABLE IF EXISTS accounts;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS verification_tokens;

-- ─── Better Auth: account ────────────────────────────────────────────────
--
-- One row per linked OAuth identity (GitHub today, Google/Apple/etc.
-- later). `accessToken` here is what `lib/user-token.ts` reads so the
-- worker can run `gh api` with the user's own token (repo scope).

CREATE TABLE account (
  id                        TEXT NOT NULL PRIMARY KEY,
  accountId                 TEXT NOT NULL,
  providerId                TEXT NOT NULL,
  userId                    TEXT NOT NULL,
  accessToken               TEXT,
  refreshToken              TEXT,
  idToken                   TEXT,
  accessTokenExpiresAt      INTEGER,
  refreshTokenExpiresAt     INTEGER,
  scope                     TEXT,
  password                  TEXT,
  createdAt                 INTEGER NOT NULL,
  updatedAt                 INTEGER NOT NULL,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_account_userId            ON account(userId);
CREATE INDEX idx_account_provider_accountId ON account(providerId, accountId);

-- ─── Better Auth: session ────────────────────────────────────────────────
--
-- Cookie-backed sessions. `token` is the opaque session id set in the
-- cookie; `expiresAt` is an epoch-ms INTEGER. ipAddress + userAgent are
-- useful for observability / future device management.

CREATE TABLE session (
  id         TEXT NOT NULL PRIMARY KEY,
  expiresAt  INTEGER NOT NULL,
  token      TEXT NOT NULL UNIQUE,
  createdAt  INTEGER NOT NULL,
  updatedAt  INTEGER NOT NULL,
  ipAddress  TEXT,
  userAgent  TEXT,
  userId     TEXT NOT NULL,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_session_userId ON session(userId);
CREATE INDEX idx_session_token  ON session(token);

-- ─── Better Auth: verification ───────────────────────────────────────────
--
-- Used for email verification / magic links / password reset tokens.
-- We don't enable those today, but the adapter expects the table to
-- exist so INSERT paths don't throw at runtime.

CREATE TABLE verification (
  id         TEXT NOT NULL PRIMARY KEY,
  identifier TEXT NOT NULL,
  value      TEXT NOT NULL,
  expiresAt  INTEGER NOT NULL,
  createdAt  INTEGER NOT NULL,
  updatedAt  INTEGER NOT NULL
);
CREATE INDEX idx_verification_identifier ON verification(identifier);
