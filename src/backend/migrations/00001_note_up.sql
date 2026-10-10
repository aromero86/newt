-- The example module: removed together with its table when the first real module arrives.
CREATE TABLE note (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_note_deleted_at ON note(deleted_at);
