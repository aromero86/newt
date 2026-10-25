-- The shop's tables, for SQLite. The files store needs none: each table is a folder.

CREATE TABLE brand (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL
);

CREATE TABLE category (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL
);

-- A product points at its brand and category by id, without a foreign key: they are
-- other modules', and a product follows their deletion a moment later.
CREATE TABLE product (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  price_cents INTEGER NOT NULL,
  brand_id TEXT,
  category_id TEXT,
  archived INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL
);

-- Only ever inserted: a product's stock is what its movements add up to.
CREATE TABLE stock_movement (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  reference TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL
);
CREATE INDEX stock_movement_product ON stock_movement (product_id);
CREATE INDEX stock_movement_reference ON stock_movement (reference);

CREATE TABLE "order" (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  lines TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  status TEXT NOT NULL,
  rejection TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL
);
CREATE INDEX order_customer ON "order" (customer_id);
CREATE INDEX product_brand ON product (brand_id);
CREATE INDEX product_category ON product (category_id);
