-- Adds a per-profile page-view counter. Simple total — no dedup, no
-- daily bucketing, no IP tracking. Owner sees it on /app; we don't
-- expose it publicly.
--
-- Incremented by POST /api/views/{handle} which fires from the
-- /{handle} layout on first paint.

ALTER TABLE user_profiles
  ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0;
