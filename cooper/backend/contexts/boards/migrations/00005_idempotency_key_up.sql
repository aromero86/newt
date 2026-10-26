-- The first answer to each POST sent with an `Idempotency-Key`, as newt/http keeps it
-- (`KeptAnswer`): its id is the key's hash, with who sent it and where.
CREATE TABLE idempotency_key (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  status INTEGER NOT NULL,
  headers TEXT NOT NULL,
  body TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
