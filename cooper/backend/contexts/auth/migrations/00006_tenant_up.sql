-- The workspaces. A deleted one keeps its row (deleted_at): its id may still be named
-- by what other contexts kept of it.
CREATE TABLE tenant (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL
);
CREATE INDEX tenant_created_by ON tenant (created_by);
