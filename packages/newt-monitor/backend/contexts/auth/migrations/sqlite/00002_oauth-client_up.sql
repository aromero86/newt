-- The OAuth clients that registered themselves (RFC 7591): MCP clients, public. Its
-- redirect URIs are a JSON list.
CREATE TABLE oauth_client (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL
);
