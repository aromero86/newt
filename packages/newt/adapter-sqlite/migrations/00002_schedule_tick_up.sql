-- The last tick each schedule of the context told, by the schedule's name: the
-- framework's own. Every process that runs the context tells a tick only by moving
-- `due_at` on from the version it read, so one of them tells it, once. Not part of
-- the outbox: the jobs a tick makes are written there, in the same transaction.
CREATE TABLE IF NOT EXISTS schedule_tick (
  id TEXT PRIMARY KEY,
  due_at TEXT NOT NULL,
  version INTEGER NOT NULL
);
