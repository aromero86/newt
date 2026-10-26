-- Each workspace's boards. Like every row of boards', it says its workspace (an auth
-- tenant), by id and without a foreign key: the workspace is another context's, and
-- the repositories see only the rows of the current one.

-- An archived board keeps its row (`deleted_at` set): its name is free again.
CREATE TABLE board (
  id TEXT COLLATE "C" PRIMARY KEY,
  workspace_id TEXT COLLATE "C" NOT NULL,
  name TEXT COLLATE "C" NOT NULL,
  description TEXT COLLATE "C" NOT NULL,
  created_at TEXT COLLATE "C" NOT NULL,
  updated_at TEXT COLLATE "C" NOT NULL,
  deleted_at TEXT COLLATE "C",
  version INTEGER NOT NULL
);
-- A name is a workspace's once, whatever its case (A to Z: `lower` of a "C" column, as `ieq` compares).
CREATE UNIQUE INDEX board_name ON board (workspace_id, lower(name)) WHERE deleted_at IS NULL;
