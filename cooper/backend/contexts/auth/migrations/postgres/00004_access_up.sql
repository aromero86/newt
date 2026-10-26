-- Who may enter each product, for one tenant (tenant_id) or for all of it (null). One
-- admin per tenant: the access module checks it after each save, in its transaction.
CREATE TABLE access (
  id TEXT COLLATE "C" PRIMARY KEY,
  user_id TEXT COLLATE "C" NOT NULL,
  product_id TEXT COLLATE "C" NOT NULL,
  tenant_id TEXT COLLATE "C",
  role TEXT COLLATE "C" NOT NULL,
  created_at TEXT COLLATE "C" NOT NULL,
  updated_at TEXT COLLATE "C" NOT NULL,
  version INTEGER NOT NULL
);
CREATE INDEX access_user ON access (user_id, product_id);
CREATE INDEX access_tenant ON access (tenant_id, role);
