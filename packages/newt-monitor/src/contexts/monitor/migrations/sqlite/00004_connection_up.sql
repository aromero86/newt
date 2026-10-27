-- Whether each application answers: the last time the monitor asked, what it said, and
-- the last time it answered. One row per application.
CREATE TABLE connection (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  identity TEXT,
  failure TEXT,
  checked_at TEXT NOT NULL,
  last_seen_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL
);
