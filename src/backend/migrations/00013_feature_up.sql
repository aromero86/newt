-- What can be done in a product, each in one area of its workspace. Never deleted:
-- a feature is retired, and what it was can still be read. No deleted_at.
CREATE TABLE feature (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  area_id TEXT NOT NULL REFERENCES feature_area(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  -- Where it sits among its area's active features, from 0; null once retired.
  position INTEGER,
  retired_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Unique in its area, retired ones too: a retired feature is restored, not repeated.
CREATE UNIQUE INDEX uq_feature_name ON feature(area_id, lower(name));
CREATE INDEX ix_feature_position ON feature(area_id, position);
