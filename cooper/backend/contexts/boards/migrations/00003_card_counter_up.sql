-- The last number each board gave a card, so a deleted card's number is never given
-- again: cards are deleted for good, and the highest one left is not the last one
-- given. Its id is the board's. A board that has cards starts from its highest number.
CREATE TABLE card_counter (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  last_number INTEGER NOT NULL,
  version INTEGER NOT NULL
);
CREATE INDEX card_counter_workspace ON card_counter (workspace_id);

INSERT INTO card_counter (id, workspace_id, last_number, version)
SELECT board_id, workspace_id, max(number), 1 FROM card GROUP BY board_id, workspace_id;
