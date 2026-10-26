-- The last tick each schedule told: the framework's own. See the SQLite one.
CREATE TABLE IF NOT EXISTS schedule_tick (
  id TEXT COLLATE "C" PRIMARY KEY,
  due_at TEXT COLLATE "C" NOT NULL,
  version INTEGER NOT NULL
);
