-- A picture of someone: the bytes are in the context's public storage, under the row's id.
-- A row stays pending until the upload is verified.
CREATE TABLE avatar (
  id TEXT COLLATE "C" PRIMARY KEY,
  user_id TEXT COLLATE "C" NOT NULL,
  content_type TEXT COLLATE "C" NOT NULL,
  status TEXT COLLATE "C" NOT NULL,
  created_at TEXT COLLATE "C" NOT NULL,
  updated_at TEXT COLLATE "C" NOT NULL,
  version INTEGER NOT NULL
);
CREATE INDEX avatar_user ON avatar (user_id, status);
-- What the hourly sweep looks for.
CREATE INDEX avatar_pending ON avatar (status, created_at);

-- Where someone's picture is read from, for anyone showing them: none until they upload one.
ALTER TABLE "user" ADD COLUMN avatar_url TEXT COLLATE "C";
