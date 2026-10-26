-- The workspaces. A deleted one keeps its row (deleted_at): its id may still be named
-- by what other contexts kept of it.
CREATE TABLE tenant (
  id TEXT COLLATE "C" PRIMARY KEY,
  name TEXT COLLATE "C" NOT NULL,
  created_by TEXT COLLATE "C" NOT NULL,
  deleted_at TEXT COLLATE "C",
  created_at TEXT COLLATE "C" NOT NULL,
  updated_at TEXT COLLATE "C" NOT NULL,
  version INTEGER NOT NULL
);
CREATE INDEX tenant_created_by ON tenant (created_by);
