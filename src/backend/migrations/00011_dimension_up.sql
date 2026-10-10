-- A workspace's dimensions and their values. Neither is deleted: a value is
-- retired, so whatever used it keeps its meaning, and can come back. No deleted_at.
CREATE TABLE dimension (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX uq_dimension_name ON dimension(workspace_id, lower(name));

-- A value keeps its id when renamed: renaming never changes what a scope means.
CREATE TABLE dimension__value (
  id TEXT PRIMARY KEY,
  dimension_id TEXT NOT NULL REFERENCES dimension(id),
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  retired_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Unique among all values, retired ones too: a retired value is restored, not repeated.
CREATE UNIQUE INDEX uq_dimension__value_name ON dimension__value(dimension_id, lower(name));
