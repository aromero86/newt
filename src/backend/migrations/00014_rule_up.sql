-- Rules: what must always hold true. A rule keeps its identity (R-7) while its
-- versions replace each other; a version is never edited. Nothing is deleted: a
-- rule is retired, and every version stays readable. No deleted_at.
CREATE TABLE rule (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  -- R-<number>, per workspace, never reused.
  number INTEGER NOT NULL,
  feature_id TEXT NOT NULL REFERENCES feature(id),
  current_version_id TEXT NOT NULL,
  retired_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX uq_rule_number ON rule(workspace_id, number);
CREATE INDEX ix_rule_feature ON rule(feature_id);

CREATE TABLE rule__version (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL REFERENCES rule(id),
  version INTEGER NOT NULL,
  kind TEXT NOT NULL,
  statement TEXT NOT NULL,
  why TEXT NOT NULL,
  -- Acceptance criteria as JSON: [{ given, when, then }].
  criteria TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX uq_rule__version ON rule__version(rule_id, version);

-- Where a version applies: the values it names, per dimension. A dimension with no
-- rows here applies in all its values. Ids, so renaming never changes the meaning.
CREATE TABLE rule__scope (
  version_id TEXT NOT NULL REFERENCES rule__version(id),
  dimension_id TEXT NOT NULL REFERENCES dimension(id),
  value_id TEXT NOT NULL REFERENCES dimension__value(id),
  PRIMARY KEY (version_id, value_id)
);

CREATE INDEX ix_rule__scope_dimension ON rule__scope(version_id, dimension_id);
