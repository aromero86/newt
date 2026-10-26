-- Analytics in the context's own database (shared/analytics): every dataset's rows
-- in one table, each one whole as JSON. A context that keeps its analytics there
-- copies this migration into its own, numbered after the ones it has. Rows are only
-- ever added: one whose id is already in its dataset is left out (`ON CONFLICT DO NOTHING`).
CREATE TABLE analytics_row (
  dataset TEXT COLLATE "C" NOT NULL,
  id TEXT COLLATE "C" NOT NULL,
  data TEXT COLLATE "C" NOT NULL,
  PRIMARY KEY (dataset, id)
);
