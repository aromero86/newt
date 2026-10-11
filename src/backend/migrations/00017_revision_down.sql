DROP TABLE delta__snapshot;
ALTER TABLE delta DROP COLUMN gone;
ALTER TABLE delta DROP COLUMN removed;
ALTER TABLE delta DROP COLUMN published;
DROP TABLE proposal__revision;
ALTER TABLE proposal DROP COLUMN revision;
ALTER TABLE proposal DROP COLUMN document;
