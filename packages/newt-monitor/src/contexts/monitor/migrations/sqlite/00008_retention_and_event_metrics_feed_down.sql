CREATE TABLE metrics_feed (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL UNIQUE,
  until TEXT,
  minute_days INTEGER NOT NULL,
  day_days INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL
);
INSERT INTO metrics_feed (id, app_id, until, minute_days, day_days, created_at, updated_at, version)
  SELECT feed.id, feed.app_id, feed.until, coalesce(retention.minute_days, 30), retention.day_days, feed.created_at, feed.updated_at, feed.version
  FROM event_metrics_feed feed LEFT JOIN retention ON retention.app_id = feed.app_id;
DROP TABLE event_metrics_feed;
DROP TABLE retention;
