-- An authorization request, from the moment a client asks until its code is traded:
-- the person's answer, and the hash of the code it was given.
CREATE TABLE oauth_grant (
  id TEXT COLLATE "C" PRIMARY KEY,
  client_id TEXT COLLATE "C" NOT NULL,
  product_id TEXT COLLATE "C" NOT NULL,
  redirect_uri TEXT COLLATE "C" NOT NULL,
  code_challenge TEXT COLLATE "C" NOT NULL,
  state TEXT COLLATE "C",
  resource TEXT COLLATE "C",
  first_party BOOLEAN NOT NULL,
  status TEXT COLLATE "C" NOT NULL,
  user_id TEXT COLLATE "C",
  code_hash TEXT COLLATE "C" UNIQUE,
  expires_at TEXT COLLATE "C" NOT NULL,
  created_at TEXT COLLATE "C" NOT NULL,
  updated_at TEXT COLLATE "C" NOT NULL,
  version INTEGER NOT NULL
);
