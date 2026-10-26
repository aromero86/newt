-- Who may enter each product, for one tenant (tenant_id) or for all of it (null). One
-- admin per tenant: the access module checks it after each save, in its transaction.
CREATE TABLE access (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  tenant_id TEXT,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL
);
CREATE INDEX access_user ON access (user_id, product_id);
CREATE INDEX access_tenant ON access (tenant_id, role);
