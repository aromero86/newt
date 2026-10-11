-- The language a workspace's content is written in (en, es): what newt writes
-- there, such as the deltas it reads from documents, follows it.
ALTER TABLE workspace ADD COLUMN language TEXT NOT NULL DEFAULT 'en';
