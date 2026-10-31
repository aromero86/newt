-- The monitor's sessions: one person signs in, from many browsers. Only the hash of
-- each token: a copy of the database opens nothing.
CREATE TABLE session (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL
);
