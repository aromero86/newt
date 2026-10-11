-- Conversations on a proposal, in general or on one of its deltas. Never deleted.
CREATE TABLE discussion (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  proposal_id TEXT NOT NULL REFERENCES proposal(id),
  -- On a delta, or on the proposal in general when null. Kept if the delta changes or goes.
  delta_id TEXT REFERENCES delta(id),
  -- The last revision published when it started: what it talks about.
  revision INTEGER NOT NULL,
  started_by TEXT NOT NULL REFERENCES user(id),
  resolved_at TEXT,
  resolved_by TEXT REFERENCES user(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX ix_discussion_proposal ON discussion(proposal_id, delta_id);
