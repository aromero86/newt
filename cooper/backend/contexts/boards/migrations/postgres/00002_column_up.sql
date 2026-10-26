-- Each board's columns, from the left.
-- "column" is a word of SQL's: quoted, it is a table's name like any other.
CREATE TABLE "column" (
  id TEXT COLLATE "C" PRIMARY KEY,
  workspace_id TEXT COLLATE "C" NOT NULL,
  board_id TEXT COLLATE "C" NOT NULL,
  name TEXT COLLATE "C" NOT NULL,
  position INTEGER NOT NULL,
  created_at TEXT COLLATE "C" NOT NULL,
  updated_at TEXT COLLATE "C" NOT NULL,
  version INTEGER NOT NULL
);
CREATE INDEX column_board ON "column" (workspace_id, board_id, position);
