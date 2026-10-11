-- The search index: each artifact, version, planned change and part of a proposal
-- of a workspace, with what a result shows (data, JSON) and the vector of its text
-- once the embeddings model computes it. Rebuilt from the other modules at will.
CREATE TABLE search_entry (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  -- feature-area, feature, rule or proposal.
  kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  -- in force, planned, proposals or history.
  layer TEXT NOT NULL,
  -- Which part of the target: '' for the whole, v2 for a version, s3 for a section, a delta's id.
  part TEXT NOT NULL,
  data TEXT NOT NULL,
  text TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  -- Float32 values; null until computed, or when the model changes.
  vector BLOB,
  model TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX uq_search_entry ON search_entry(workspace_id, kind, target_id, layer, part);

-- The words of each entry, without accents or case.
CREATE VIRTUAL TABLE search_entry_text USING fts5(entry_id UNINDEXED, text, tokenize = 'unicode61 remove_diacritics 2');
