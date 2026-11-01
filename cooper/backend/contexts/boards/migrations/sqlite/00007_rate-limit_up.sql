-- What each caller did lately, for the context's rate limits, as newt keeps it
-- (`RateLimitRow`, `TableRateLimitStore`): every instance on this database counts in
-- it. Its id is the key's hash; the index is how the forgotten ones are removed.
CREATE TABLE rate_limit (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  start TEXT NOT NULL,
  count INTEGER NOT NULL,
  previous INTEGER NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX rate_limit_expires_at ON rate_limit (expires_at);
