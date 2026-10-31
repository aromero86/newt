-- Where each application's code is, for the commits it deploys to link to.
ALTER TABLE app ADD COLUMN repository TEXT;

-- The commit each instance was built from, as it tells it.
ALTER TABLE instance ADD COLUMN "commit" TEXT;

-- Each commit an application deployed: when its first instance started, and its title
-- once its repository says it.
CREATE TABLE deployment (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  "commit" TEXT NOT NULL,
  title TEXT,
  deployed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL,
  UNIQUE (app_id, "commit")
);
CREATE INDEX deployment_app_deployed ON deployment (app_id, deployed_at);
