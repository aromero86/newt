-- How many days the minutes of an application's servers and instances are kept.
ALTER TABLE retention ADD COLUMN resource_minute_days INTEGER NOT NULL DEFAULT 30;

-- Up to which minute an application's instances were collected.
CREATE TABLE instances_feed (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL UNIQUE,
  until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL
);

-- Each instance of each application as it was last collected: its process and its server.
CREATE TABLE instance (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  pid INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  status TEXT NOT NULL,
  stopped_at TEXT,
  process TEXT NOT NULL,
  server TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL,
  UNIQUE (app_id, instance_id)
);
