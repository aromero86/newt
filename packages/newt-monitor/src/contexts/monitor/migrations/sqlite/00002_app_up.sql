-- The applications the monitor watches: where their monitor endpoint is, and their key,
-- sealed with the monitor's secret (never the key itself).
CREATE TABLE app (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  sealed_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL
);
-- A name is one application's, whatever its case (A to Z, as `lower` and `ieq` compare).
CREATE UNIQUE INDEX app_name ON app (lower(name));
