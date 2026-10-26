-- The OAuth clients: each product's own (its client_id is the product's id) and those
-- that registered themselves (RFC 7591). Its redirect URIs are a JSON list.
CREATE TABLE oauth_client (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL,
  product_id TEXT,
  secret_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL
);
