-- metrics_feed held two things: how long an application's metrics are kept, and up to
-- which minute its event counts were collected. Each goes to the module it belongs to.
CREATE TABLE retention (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL UNIQUE,
  minute_days INTEGER NOT NULL,
  day_days INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL
);
INSERT INTO retention (id, app_id, minute_days, day_days, created_at, updated_at, version)
  SELECT id, app_id, minute_days, day_days, created_at, updated_at, version FROM metrics_feed;

CREATE TABLE event_metrics_feed (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL UNIQUE,
  until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL
);
INSERT INTO event_metrics_feed (id, app_id, until, created_at, updated_at, version)
  SELECT id, app_id, until, created_at, updated_at, version FROM metrics_feed;

DROP TABLE metrics_feed;

