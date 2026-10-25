-- The outbox every store has: the framework's own, applied after the context's
-- migrations. See the SQLite one for what each column means.
CREATE TABLE IF NOT EXISTS job_queue (
  name VARCHAR(255) COLLATE utf8mb4_bin PRIMARY KEY,
  event VARCHAR(255) NOT NULL,
  attempts INTEGER NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  last_seen_at VARCHAR(32) NOT NULL
);

CREATE TABLE IF NOT EXISTS job (
  id VARCHAR(64) COLLATE utf8mb4_bin PRIMARY KEY,
  queue VARCHAR(255) COLLATE utf8mb4_bin NOT NULL,
  event LONGTEXT NOT NULL,
  status VARCHAR(16) NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  run_after VARCHAR(32) NOT NULL,
  locked_by VARCHAR(64),
  locked_until VARCHAR(32),
  last_error LONGTEXT,
  created_at VARCHAR(32) NOT NULL,
  updated_at VARCHAR(32) NOT NULL,
  INDEX idx_job_ready (status, run_after),
  INDEX idx_job_queue_status (queue, status)
);
