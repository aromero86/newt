-- Proposals: every change to a product's definition. PROP-<number> per workspace.
-- Never deleted: one that does not go ahead is discarded. No deleted_at.
CREATE TABLE proposal (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  -- draft, in review, accepted, merged or discarded.
  status TEXT NOT NULL,
  -- Made from one point of the definition, with a single delta.
  quick INTEGER NOT NULL,
  created_by TEXT NOT NULL REFERENCES user(id),
  accepted_by TEXT REFERENCES user(id),
  accepted_at TEXT,
  merged_by TEXT REFERENCES user(id),
  merged_at TEXT,
  discarded_by TEXT REFERENCES user(id),
  discarded_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX uq_proposal_number ON proposal(workspace_id, number);
CREATE INDEX ix_proposal_status ON proposal(workspace_id, status);
