-- Releases: a picture of a workspace's definition in force when its product was
-- released. Published once, never changed nor deleted.
CREATE TABLE release (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  published_by TEXT NOT NULL REFERENCES user(id),
  published_at TEXT NOT NULL,
  -- What changed since the release before it.
  added INTEGER NOT NULL,
  changed INTEGER NOT NULL,
  retired INTEGER NOT NULL,
  restored INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX uq_release_name ON release(workspace_id, lower(name));

-- The picture: each artifact of the definition as it was, retired ones too. JSON.
CREATE TABLE release__artifact (
  release_id TEXT NOT NULL REFERENCES release(id),
  kind TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  content TEXT NOT NULL,
  PRIMARY KEY (release_id, artifact_id)
);
