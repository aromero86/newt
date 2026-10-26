-- The OAuth clients: each product's own (its client_id is the product's id) and those
-- that registered themselves (RFC 7591). Its redirect URIs are a JSON list.
CREATE TABLE oauth_client (
  id TEXT COLLATE "C" PRIMARY KEY,
  client_id TEXT COLLATE "C" NOT NULL UNIQUE,
  name TEXT COLLATE "C" NOT NULL,
  redirect_uris JSONB NOT NULL,
  product_id TEXT COLLATE "C",
  secret_hash TEXT COLLATE "C",
  created_at TEXT COLLATE "C" NOT NULL,
  updated_at TEXT COLLATE "C" NOT NULL,
  version INTEGER NOT NULL
);
