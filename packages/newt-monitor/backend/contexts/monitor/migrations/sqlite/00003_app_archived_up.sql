-- An application archived: the monitor stops watching it, and keeps all it knows of it
-- until it is deleted, which only an archived one can be.
ALTER TABLE app ADD COLUMN archived_at TEXT;
