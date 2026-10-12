-- A revision's deltas are extracted from its document in the background: each
-- revision says how that stands (extracting, ready or failed) and, when it failed,
-- why. Every revision published so far had its deltas extracted already: ready.
ALTER TABLE proposal__revision ADD COLUMN extraction TEXT NOT NULL DEFAULT 'ready';
ALTER TABLE proposal__revision ADD COLUMN extraction_error TEXT;
-- What the server picks up again when it starts.
CREATE INDEX idx_proposal__revision_extracting ON proposal__revision (extraction) WHERE extraction = 'extracting';
