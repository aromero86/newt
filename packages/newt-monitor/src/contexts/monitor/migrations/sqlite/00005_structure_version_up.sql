-- What each application was made of, each time it changed: a version, with the whole
-- description its endpoint gave, and its hash to tell the next one is the same.
CREATE TABLE structure_version (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  hash TEXT NOT NULL,
  description TEXT NOT NULL,
  taken_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL
);
CREATE INDEX structure_version_app ON structure_version (app_id, id);
