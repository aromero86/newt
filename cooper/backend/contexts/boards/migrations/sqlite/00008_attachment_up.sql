-- A file attached to a card: what it is and whose. The bytes are in the context's private
-- storage, under the row's id. A row stays pending until the upload is verified.
CREATE TABLE attachment (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL
);
CREATE INDEX attachment_card ON attachment (workspace_id, card_id);
-- What the hourly sweep looks for, across workspaces.
CREATE INDEX attachment_pending ON attachment (status, created_at);
