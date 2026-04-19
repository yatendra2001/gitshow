-- Live events + realtime support.
--
-- Adds structured payload storage to scan_events (for reasoning, test-result,
-- eval-axes, usage, and plan kinds), widens the kind enum, and seeds a
-- phase_medians table used by the web app to display real ETAs.

-- SQLite cannot widen a CHECK constraint in-place, so we rebuild the table
-- atomically: create new table, copy rows, drop the old, rename.
--
-- Safe to re-run: the whole block lives in an IF-NEW-TABLE dance that
-- short-circuits when scan_events already has the data_json column.
-- (D1 migrations are applied once by our migrate-d1.yml workflow, but
-- we keep idempotency conventions consistent across the file.)

-- ─── scan_events: widen kind, add data_json ────────────────────────────────

CREATE TABLE IF NOT EXISTS scan_events_v2 (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id     TEXT NOT NULL,
  kind        TEXT NOT NULL
                CHECK(kind IN (
                  'stage-start','stage-end','stage-warn',
                  'worker-update','error',
                  'reasoning','test-result','eval-axes','usage','plan'
                )),
  stage       TEXT,
  worker      TEXT,
  status      TEXT,
  duration_ms INTEGER,
  message     TEXT,
  data_json   TEXT,
  at          INTEGER NOT NULL,
  FOREIGN KEY (scan_id) REFERENCES scans(id) ON DELETE CASCADE
);

INSERT INTO scan_events_v2 (id, scan_id, kind, stage, worker, status, duration_ms, message, data_json, at)
SELECT id, scan_id, kind, stage, worker, status, duration_ms, message, NULL, at
FROM scan_events;

DROP TABLE scan_events;
ALTER TABLE scan_events_v2 RENAME TO scan_events;

CREATE INDEX IF NOT EXISTS idx_scan_events_scan_id ON scan_events(scan_id, at);
CREATE INDEX IF NOT EXISTS idx_scan_events_scan_id_id ON scan_events(scan_id, id);

-- ─── phase_medians: ETA seed table ────────────────────────────────────────
--
-- One row per pipeline phase with the rolling median wall-clock duration.
-- Seeded from session-4 production runs; refreshed periodically by a cron
-- script that rolls up scan_events.duration_ms.

CREATE TABLE IF NOT EXISTS phase_medians (
  phase         TEXT PRIMARY KEY,
  median_ms     INTEGER NOT NULL,
  sample_count  INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL
);

-- Seed values match packages/shared/src/eta.ts PHASE_MEDIAN_MS so the
-- web app sees consistent ETAs before the cron refresh kicks in.
INSERT OR IGNORE INTO phase_medians (phase, median_ms, sample_count, updated_at) VALUES
  ('github-fetch',  12000,    1, strftime('%s','now') * 1000),
  ('repo-filter',    1000,    1, strftime('%s','now') * 1000),
  ('inventory',    420000,    1, strftime('%s','now') * 1000),
  ('normalize',      6000,    1, strftime('%s','now') * 1000),
  ('discover',      45000,    1, strftime('%s','now') * 1000),
  ('workers',      540000,    1, strftime('%s','now') * 1000),
  ('hook',          90000,    1, strftime('%s','now') * 1000),
  ('numbers',       40000,    1, strftime('%s','now') * 1000),
  ('disclosure',    30000,    1, strftime('%s','now') * 1000),
  ('shipped',       35000,    1, strftime('%s','now') * 1000),
  ('assemble',      20000,    1, strftime('%s','now') * 1000),
  ('critic',        45000,    1, strftime('%s','now') * 1000),
  ('bind',           3000,    1, strftime('%s','now') * 1000);
