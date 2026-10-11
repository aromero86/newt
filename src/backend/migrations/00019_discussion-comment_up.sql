-- What each person says in a conversation, in order. Edited by its author, never deleted.
CREATE TABLE discussion_comment (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  discussion_id TEXT NOT NULL REFERENCES discussion(id),
  author_id TEXT NOT NULL REFERENCES user(id),
  body TEXT NOT NULL,
  edited_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX ix_discussion_comment_discussion ON discussion_comment(discussion_id);
