-- The outbox every store has: the framework's own, applied after the context's
-- migrations. See the SQLite one for what each column means.
CREATE TABLE IF NOT EXISTS job_queue (
  name TEXT PRIMARY KEY,
  event TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

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
CREATE INDEX IF NOT EXISTS idx_job_ready ON job (status, run_after);
CREATE INDEX IF NOT EXISTS idx_job_queue_status ON job (queue, status);
