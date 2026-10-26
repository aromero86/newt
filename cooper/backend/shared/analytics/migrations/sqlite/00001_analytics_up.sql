-- Analytics on SQLite (shared/analytics): every dataset's rows in one table, each one
-- whole as JSON. A context that keeps its analytics in its own database copies this
-- migration into its own, numbered after the ones it has. Rows are only ever added:
-- one whose id is already in its dataset is left out (`INSERT OR IGNORE`).
CREATE TABLE analytics_row (
  dataset TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (dataset, id)
);
