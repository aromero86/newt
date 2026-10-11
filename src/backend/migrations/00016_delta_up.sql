-- The deltas of each proposal: one change to one artifact each. A delta is removed
-- for good while its proposal is open: until merged it changed nothing.
CREATE TABLE delta (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  proposal_id TEXT NOT NULL REFERENCES proposal(id),
  -- dimension, feature-area, feature or rule.
  kind TEXT NOT NULL,
  -- create, change, retire or restore.
  operation TEXT NOT NULL,
  -- The artifact it changes; for a create, the id the new artifact will have.
  target_id TEXT NOT NULL,
  target_label TEXT NOT NULL,
  -- JSON: the artifact when the delta was written, and the state it leaves it in.
  before TEXT,
  after TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX ix_delta_proposal ON delta(proposal_id);

-- One verdict per person and delta: approved, or rejected with a reason.
CREATE TABLE delta__review (
  delta_id TEXT NOT NULL REFERENCES delta(id),
  user_id TEXT NOT NULL REFERENCES user(id),
  verdict TEXT NOT NULL,
  reason TEXT NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (delta_id, user_id)
);
