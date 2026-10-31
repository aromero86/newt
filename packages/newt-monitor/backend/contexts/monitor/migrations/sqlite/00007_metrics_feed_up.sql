-- What the monitor collects of each application's metrics: up to which minute it has
-- them, and how long it keeps them (minute detail, and the daily summary).
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
