DROP INDEX idx_proposal__revision_extracting;
ALTER TABLE proposal__revision DROP COLUMN extraction_error;
ALTER TABLE proposal__revision DROP COLUMN extraction;
