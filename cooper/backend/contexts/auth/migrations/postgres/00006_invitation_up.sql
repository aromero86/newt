-- Invitations to a workspace. The hash of the link's token is set when the email
-- leaves, by a worker.
CREATE TABLE invitation (
  id TEXT COLLATE "C" PRIMARY KEY,
  tenant_id TEXT COLLATE "C" NOT NULL,
  email TEXT COLLATE "C" NOT NULL,
  invited_by TEXT COLLATE "C" NOT NULL,
  status TEXT COLLATE "C" NOT NULL,
  token_hash TEXT COLLATE "C" UNIQUE,
  accepted_by TEXT COLLATE "C",
  expires_at TEXT COLLATE "C" NOT NULL,
  created_at TEXT COLLATE "C" NOT NULL,
  updated_at TEXT COLLATE "C" NOT NULL,
  version INTEGER NOT NULL
);
CREATE INDEX invitation_tenant ON invitation (tenant_id, status);
