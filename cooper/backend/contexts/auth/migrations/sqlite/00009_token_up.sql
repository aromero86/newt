-- The tokens a grant was traded for: one row per grant, its access and refresh tokens
-- rotated in place. Only their hashes.
CREATE TABLE token (
  id TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  resource TEXT,
  access_token_hash TEXT NOT NULL UNIQUE,
  access_expires_at TEXT NOT NULL,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  previous_refresh_token_hash TEXT,
  refresh_expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL
);
CREATE INDEX token_previous_refresh ON token (previous_refresh_token_hash);
