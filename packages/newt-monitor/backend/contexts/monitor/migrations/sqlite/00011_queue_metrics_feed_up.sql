-- Up to which minute the monitor has collected each application's queue flows.
CREATE TABLE queue_metrics_feed (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL UNIQUE,
  until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL
);
