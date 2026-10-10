-- One password per account. Credentials are replaced, never deleted: no deleted_at.
CREATE TABLE auth__credential (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id),
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX uq_auth__credential_user ON auth__credential(user_id);

-- Sessions are not history: signing out or expiring removes the row, so no deleted_at.
-- Only a hash of the token is stored: a copy of the database opens no session.
CREATE TABLE auth__session (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id),
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX uq_auth__session_token ON auth__session(token_hash);
CREATE INDEX idx_auth__session_user ON auth__session(user_id);
