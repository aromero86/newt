-- Every refresh token a grant's token replaced, by its hash: brought again, however
-- long ago, it was copied. A grant's go with its token. It starts with the one
-- each token replaced last, the only one kept until now.
CREATE TABLE token_spent_refresh (
  id TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL,
  spent_at TEXT NOT NULL,
  version INTEGER NOT NULL
);
CREATE INDEX token_spent_refresh_grant ON token_spent_refresh (grant_id);
INSERT INTO token_spent_refresh (id, grant_id, spent_at, version)
  SELECT previous_refresh_token_hash, grant_id, updated_at, 1 FROM token WHERE previous_refresh_token_hash IS NOT NULL;
