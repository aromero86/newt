-- The accounts. An email belongs to one account: the user module checks it after each
-- save, in its transaction (a rule over rows any store can keep), so this index only
-- finds an account by its email quickly. Emails are kept in lower case.
CREATE TABLE "user" (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL
);
CREATE INDEX user_email ON "user" (email);
