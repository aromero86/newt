-- A context's web sessions (shared/web-session): each context that signs its people in
-- through auth copies this migration into its own, numbered after the ones it has.
-- Only the hash of each token: a copy of the database opens nothing.
CREATE TABLE session (
  id TEXT COLLATE "C" PRIMARY KEY,
  user_id TEXT COLLATE "C" NOT NULL,
  token_hash TEXT COLLATE "C" NOT NULL UNIQUE,
  expires_at TEXT COLLATE "C" NOT NULL,
  created_at TEXT COLLATE "C" NOT NULL,
  updated_at TEXT COLLATE "C" NOT NULL,
  version INTEGER NOT NULL
);
CREATE INDEX session_user_id ON session (user_id);
