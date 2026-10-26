-- The tokens a grant was traded for: one row per grant, its access and refresh tokens
-- rotated in place. Only their hashes.
CREATE TABLE token (
  id TEXT COLLATE "C" PRIMARY KEY,
  grant_id TEXT COLLATE "C" NOT NULL UNIQUE,
  user_id TEXT COLLATE "C" NOT NULL,
  client_id TEXT COLLATE "C" NOT NULL,
  product_id TEXT COLLATE "C" NOT NULL,
  resource TEXT COLLATE "C",
  access_token_hash TEXT COLLATE "C" NOT NULL UNIQUE,
  access_expires_at TEXT COLLATE "C" NOT NULL,
  refresh_token_hash TEXT COLLATE "C" NOT NULL UNIQUE,
  previous_refresh_token_hash TEXT COLLATE "C",
  refresh_expires_at TEXT COLLATE "C" NOT NULL,
  created_at TEXT COLLATE "C" NOT NULL,
  updated_at TEXT COLLATE "C" NOT NULL,
  version INTEGER NOT NULL
);
CREATE INDEX token_previous_refresh ON token (previous_refresh_token_hash);
