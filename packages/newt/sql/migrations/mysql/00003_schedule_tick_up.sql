-- The last tick each schedule told: the framework's own. See the SQLite one.
CREATE TABLE IF NOT EXISTS schedule_tick (
  id VARCHAR(255) COLLATE utf8mb4_0900_bin PRIMARY KEY,
  due_at VARCHAR(32) COLLATE utf8mb4_0900_bin NOT NULL,
  version INTEGER NOT NULL
);
