-- Invitations to a workspace. The hash of the link's token is set when the email
-- leaves, by a worker.
CREATE TABLE invitation (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  email TEXT NOT NULL,
  invited_by TEXT NOT NULL,
  status TEXT NOT NULL,
  token_hash TEXT UNIQUE,
  accepted_by TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL
);
CREATE INDEX invitation_tenant ON invitation (tenant_id, status);
