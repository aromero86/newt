-- Deltas come from the proposal's document: each keeps the sentences it comes
-- from (JSON, verbatim; empty for deltas written by hand), and each revision what
-- its extraction could not settle (JSON: question and sentences).
ALTER TABLE delta ADD COLUMN sources TEXT NOT NULL DEFAULT '[]';
ALTER TABLE proposal__revision ADD COLUMN questions TEXT NOT NULL DEFAULT '[]';
