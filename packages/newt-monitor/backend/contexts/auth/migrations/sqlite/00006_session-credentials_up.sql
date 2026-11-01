-- What the sessions were opened with: an HMAC of the user and password under the
-- monitor's secret, never the password. Kept the first time it starts; started with
-- others, every session and token the old ones opened ends.
CREATE TABLE session_credentials (
  id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  version INTEGER NOT NULL
);
