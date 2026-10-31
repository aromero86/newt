-- Every context, module, use case and event any version of an application had: when
-- it first appeared, when it was last there, and when it went (archived, never removed).
CREATE TABLE catalog_item (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  item_id TEXT NOT NULL,
  context TEXT NOT NULL,
  module TEXT,
  name TEXT NOT NULL,
  details TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL
);
-- One item of each kind and id per application.
CREATE UNIQUE INDEX catalog_item_key ON catalog_item (app_id, kind, item_id);
