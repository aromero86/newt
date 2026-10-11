-- A proposal keeps a working copy (its document and its deltas as they are being
-- written) and publishes revisions of it. Reviewers only see what is published.
ALTER TABLE proposal ADD COLUMN document TEXT NOT NULL DEFAULT '';
-- The last revision published; 0 while none is.
ALTER TABLE proposal ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;

-- Revisions are never edited nor deleted: each is a picture of the proposal.
CREATE TABLE proposal__revision (
  proposal_id TEXT NOT NULL REFERENCES proposal(id),
  number INTEGER NOT NULL,
  message TEXT NOT NULL,
  document TEXT NOT NULL,
  published_by TEXT NOT NULL REFERENCES user(id),
  published_at TEXT NOT NULL,
  -- What changed in its deltas, and whether its document did.
  added INTEGER NOT NULL,
  changed INTEGER NOT NULL,
  removed INTEGER NOT NULL,
  document_changed INTEGER NOT NULL,
  PRIMARY KEY (proposal_id, number)
);

-- JSON: the delta as the last revision published it ({ targetLabel, before, after }).
ALTER TABLE delta ADD COLUMN published TEXT;
-- Removed in the working copy; still part of the proposal until a revision says so.
ALTER TABLE delta ADD COLUMN removed INTEGER NOT NULL DEFAULT 0;
-- Removed by a published revision: only history now.
ALTER TABLE delta ADD COLUMN gone INTEGER NOT NULL DEFAULT 0;

-- Each delta in each revision: added, changed, unchanged or removed, with what it
-- said then and before.
CREATE TABLE delta__snapshot (
  delta_id TEXT NOT NULL REFERENCES delta(id),
  proposal_id TEXT NOT NULL REFERENCES proposal(id),
  revision INTEGER NOT NULL,
  change TEXT NOT NULL,
  content TEXT,
  previous TEXT,
  PRIMARY KEY (delta_id, revision)
);

CREATE INDEX ix_delta__snapshot_revision ON delta__snapshot(proposal_id, revision);

-- Proposals that already left the draft count as published once, as they are.
UPDATE delta SET published = json_object('targetLabel', target_label, 'before', json(before), 'after', json(after))
WHERE proposal_id IN (SELECT id FROM proposal WHERE status <> 'draft');

INSERT INTO delta__snapshot (delta_id, proposal_id, revision, change, content, previous)
SELECT id, proposal_id, 1, 'added', published, NULL FROM delta WHERE published IS NOT NULL;

INSERT INTO proposal__revision (proposal_id, number, message, document, published_by, published_at, added, changed, removed, document_changed)
SELECT p.id, 1, 'First revision', '', p.created_by, p.updated_at, (SELECT count(*) FROM delta d WHERE d.proposal_id = p.id), 0, 0, 0
FROM proposal p WHERE p.status <> 'draft';

UPDATE proposal SET revision = 1 WHERE status <> 'draft';
