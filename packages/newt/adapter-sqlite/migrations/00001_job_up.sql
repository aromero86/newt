-- The outbox every context has, whatever it keeps: the framework's own, applied after
-- the context's migrations. `IF NOT EXISTS`, since the contexts made before it
-- created these tables in migrations of their own.

-- The queues: one for each handler subscribed in `handler` mode, named as it is.
-- Every worker registers the queues it runs when it starts, and keeps `last_seen_at`
-- fresh (each minute) while it runs. A queue no worker has seen for a while (five
-- minutes) is dead: nobody subscribes to it any more, renamed or removed, so its
-- jobs wait and nobody runs them.
CREATE TABLE IF NOT EXISTS job_queue (
  name TEXT PRIMARY KEY,
  event TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

-- What a handler subscribed in `handler` mode does in reaction to an event: written
-- with the change that published it, in its transaction, so both are stored or
-- neither is. A worker claims a job with a lease (`locked_by` until `locked_until`)
-- and processes it outside any transaction; once the lease runs out, its worker is
-- taken for gone and another one may claim it. `attempts` counts claims and fences
-- each one: a worker only closes the claim it made. Jobs done are purged after a
-- while, so this table is not soft deleted.
CREATE TABLE IF NOT EXISTS job (
  id TEXT PRIMARY KEY,
  queue TEXT NOT NULL,
  event TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  run_after TEXT NOT NULL,
  locked_by TEXT,
  locked_until TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- What a worker claims next.
CREATE INDEX IF NOT EXISTS idx_job_ready ON job (status, run_after);
-- How each queue stands.
CREATE INDEX IF NOT EXISTS idx_job_queue_status ON job (queue, status);
