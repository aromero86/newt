-- An invitation to a workspace for someone without an account yet. It is not an
-- account: the person exists in newt only once they sign up. Accepted, cancelled
-- and expired invitations are kept as history. No deleted_at.
CREATE TABLE workspace_invitation (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  email TEXT NOT NULL,
  invited_by TEXT NOT NULL REFERENCES user(id),
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_workspace_invitation_workspace ON workspace_invitation(workspace_id);
CREATE INDEX idx_workspace_invitation_email ON workspace_invitation(email);
