CREATE TABLE user (
  id TEXT PRIMARY KEY,
  nick TEXT NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Nick and email are unique whatever their case: @Lucia and @lucia are the same person.
CREATE UNIQUE INDEX uq_user_nick_alive ON user(lower(nick)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_user_email_alive ON user(lower(email)) WHERE deleted_at IS NULL;
