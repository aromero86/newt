-- Up to which minute the monitor has collected how each application's use case calls ended.
CREATE TABLE use_case_errors_feed (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL UNIQUE,
  until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL
);
