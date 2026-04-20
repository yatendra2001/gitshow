-- Capture the GitHub login (username) on the users table so we can show
-- @yatendra2001 in the UI instead of the display name "Yatendra Kumar"
-- that the default @auth/d1-adapter stored in `name`.
--
-- Additive — `login` is nullable on existing rows and backfilled on
-- the next sign-in (auth.ts signIn callback UPDATEs it). For the
-- single-person MVP we also wipe sessions so the next visit routes
-- through a fresh OAuth round-trip.

ALTER TABLE users ADD COLUMN login TEXT;

CREATE INDEX IF NOT EXISTS idx_users_login ON users(login);
