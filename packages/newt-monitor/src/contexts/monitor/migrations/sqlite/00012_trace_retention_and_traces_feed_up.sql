-- How many days an application's traces are kept, and up to which minute they were collected.
ALTER TABLE retention ADD COLUMN trace_days INTEGER NOT NULL DEFAULT 7;

CREATE TABLE traces_feed (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL UNIQUE,
  until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL
);
