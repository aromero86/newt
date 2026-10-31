-- An authorization request, from the moment a client asks until its code is traded:
-- the person's answer, and the hash of the code it was given.
CREATE TABLE oauth_grant (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  state TEXT,
  resource TEXT NOT NULL,
  status TEXT NOT NULL,
  user_id TEXT,
  code_hash TEXT UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL
);
