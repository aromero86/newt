-- The groups a workspace's features live in: Checkout, Account, Backoffice…
-- Never deleted: an area is retired, and can come back. No deleted_at.
CREATE TABLE feature_area (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  -- Where it sits among the workspace's active areas, from 0; null once retired.
  position INTEGER,
  -- Kept by the feature module, so an area with active features cannot be retired.
  active_features INTEGER NOT NULL,
  retired_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Unique among all areas, retired ones too: a retired area is restored, not repeated.
CREATE UNIQUE INDEX uq_feature_area_name ON feature_area(workspace_id, lower(name));
CREATE INDEX ix_feature_area_position ON feature_area(workspace_id, position);
