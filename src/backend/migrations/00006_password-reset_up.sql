-- A request to reset a password. Requests are kept: used or cancelled ones say so,
-- which is the history of how an account was recovered. No deleted_at.
-- Only a hash of the emailed token is stored.
CREATE TABLE password_reset (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id),
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX uq_password_reset_token ON password_reset(token_hash);
CREATE INDEX idx_password_reset_user ON password_reset(user_id);
