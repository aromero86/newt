-- A file attached to a card: what it is and whose. The bytes are in the context's private
-- storage, under the row's id. A row stays pending until the upload is verified.
CREATE TABLE attachment (
  id TEXT COLLATE "C" PRIMARY KEY,
  workspace_id TEXT COLLATE "C" NOT NULL,
  card_id TEXT COLLATE "C" NOT NULL,
  filename TEXT COLLATE "C" NOT NULL,
  content_type TEXT COLLATE "C" NOT NULL,
  size_bytes INTEGER NOT NULL,
  status TEXT COLLATE "C" NOT NULL,
  created_at TEXT COLLATE "C" NOT NULL,
  updated_at TEXT COLLATE "C" NOT NULL,
  version INTEGER NOT NULL
);
CREATE INDEX attachment_card ON attachment (workspace_id, card_id);
-- What the hourly sweep looks for, across workspaces.
CREATE INDEX attachment_pending ON attachment (status, created_at);
