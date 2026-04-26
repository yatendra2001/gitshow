-- 0014_view_events.sql
-- Per-view event log for the published portfolio analytics dashboard.
--
-- Aggregate `user_profiles.view_count` (migration 0007) stays as the
-- cheap badge counter. This table backs the per-day, per-source,
-- per-country breakdowns shown at /app.
--
-- visitor_hash = sha256(salt + ip + ua) — opaque, non-reversible. We
-- never store raw IP. CF gives us country/region/city for free in the
-- request properties, so the geo columns are populated at write time.

CREATE TABLE IF NOT EXISTS view_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  slug            TEXT    NOT NULL,
  visitor_hash    TEXT    NOT NULL,
  referrer_host   TEXT,
  referrer_url    TEXT,
  country         TEXT,
  region          TEXT,
  city            TEXT,
  device          TEXT,
  browser         TEXT,
  os              TEXT,
  path            TEXT,
  ts              INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_view_events_slug_ts
  ON view_events(slug, ts DESC);

CREATE INDEX IF NOT EXISTS idx_view_events_slug_visitor
  ON view_events(slug, visitor_hash);
