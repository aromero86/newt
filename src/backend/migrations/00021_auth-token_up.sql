-- Access tokens: how an AI assistant, or anything outside the browser, acts for a
-- person. Only the hash of each secret is kept. Revoking one deletes it.
CREATE TABLE auth_token (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id),
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  last_used_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX uq_auth_token_token ON auth_token(token_hash);
CREATE INDEX idx_auth_token_user ON auth_token(user_id);
