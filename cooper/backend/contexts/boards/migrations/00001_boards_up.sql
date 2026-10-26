-- boards' tables: each workspace's boards, their columns and their cards. Every row
-- says its workspace (an auth tenant), by id and without a foreign key: the workspace
-- is another context's, and the repositories see only the rows of the current one.

-- An archived board keeps its row (`deleted_at` set): its name is free again.
CREATE TABLE board (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  version INTEGER NOT NULL
);
-- A name is a workspace's once, whatever its case (A to Z, as `lower` and `ieq` compare).
CREATE UNIQUE INDEX board_name ON board (workspace_id, lower(name)) WHERE deleted_at IS NULL;

-- "column" is a word of SQL's: quoted, it is a table's name like any other.
CREATE TABLE "column" (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  board_id TEXT NOT NULL,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL
);
CREATE INDEX column_board ON "column" (workspace_id, board_id, position);

-- A card points at its board, its column and the member it is assigned to by id: the
-- column is another module's, the member another context's.
CREATE TABLE card (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  board_id TEXT NOT NULL,
  column_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  assignee_id TEXT,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL
);
-- #1, #2…: a number is its board's once.
CREATE UNIQUE INDEX card_number ON card (board_id, number);
CREATE INDEX card_column ON card (workspace_id, column_id, position);
CREATE INDEX card_assignee ON card (workspace_id, assignee_id);
