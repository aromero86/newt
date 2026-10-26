-- The first answer to each POST sent with an `Idempotency-Key`, as newt/http keeps it
-- (`KeptAnswer`): its id is the key's hash, with who sent it and where, and the
-- hash of the body it answered. The index is how the forgotten ones are removed.
CREATE TABLE idempotency_key (
  id TEXT COLLATE "C" PRIMARY KEY,
  version INTEGER NOT NULL,
  body_hash TEXT COLLATE "C" NOT NULL,
  status INTEGER NOT NULL,
  headers TEXT COLLATE "C" NOT NULL,
  body TEXT COLLATE "C" NOT NULL,
  expires_at TEXT COLLATE "C" NOT NULL
);
CREATE INDEX idempotency_key_expires_at ON idempotency_key (expires_at);
