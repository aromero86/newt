-- The first answer to each POST sent with an `Idempotency-Key`, as newt/http keeps it
-- (`KeptAnswer`): its id is the key's hash, with who sent it and where, and the
-- hash of the body it answered. The index is how the forgotten ones are removed.
CREATE TABLE idempotency_key (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  body_hash TEXT NOT NULL,
  status INTEGER NOT NULL,
  headers TEXT NOT NULL,
  body TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idempotency_key_expires_at ON idempotency_key (expires_at);
