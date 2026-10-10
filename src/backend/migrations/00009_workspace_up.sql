-- A workspace: one product. Archived ones are kept and can come back. No deleted_at.
CREATE TABLE workspace (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL REFERENCES user(id),
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- A name is unique among the workspaces of whoever created them, whatever its case.
CREATE UNIQUE INDEX uq_workspace_name ON workspace(created_by, lower(name));
