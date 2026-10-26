-- Each card's activity: one row for each thing that happened to it, by the id of the
-- event that told it. Rows are only ever added, never changed; a card deleted keeps
-- its history. Who did it is a user of auth's, by id; null when boards did it itself.
CREATE TABLE activity (
  id TEXT COLLATE "C" PRIMARY KEY,
  workspace_id TEXT COLLATE "C" NOT NULL,
  board_id TEXT COLLATE "C" NOT NULL,
  card_id TEXT COLLATE "C" NOT NULL,
  kind TEXT COLLATE "C" NOT NULL,
  actor_id TEXT COLLATE "C",
  via TEXT COLLATE "C",
  at TEXT COLLATE "C" NOT NULL,
  detail JSONB NOT NULL,
  created_at TEXT COLLATE "C" NOT NULL,
  updated_at TEXT COLLATE "C" NOT NULL,
  version INTEGER NOT NULL
);
-- A card's activity, the newest first (ids are v7: in the order they were told).
CREATE INDEX activity_card ON activity (workspace_id, card_id, id);
