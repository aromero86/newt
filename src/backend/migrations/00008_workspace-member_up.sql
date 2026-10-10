-- Who belongs to each workspace. Leaving or being removed keeps the row, inactive:
-- what the person did there still needs their name. No deleted_at.
CREATE TABLE workspace_member (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id),
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX uq_workspace_member ON workspace_member(workspace_id, user_id);
CREATE INDEX idx_workspace_member_user ON workspace_member(user_id);
