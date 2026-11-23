-- Licensed, public sealed-product retail references only. No holdings or costs.
CREATE TABLE IF NOT EXISTS sealed_feed (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  fetched_at TEXT,
  next_refresh_at TEXT NOT NULL DEFAULT '',
  lease_until TEXT NOT NULL DEFAULT '',
  last_attempt_at TEXT,
  last_error TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0)
);
INSERT OR IGNORE INTO sealed_feed (id) VALUES (1);

CREATE TABLE IF NOT EXISTS sealed_products (
  product_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  search_text TEXT NOT NULL,
  product_type TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  provider_date TEXT NOT NULL,
  seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sealed_products_type ON sealed_products(product_type, name);
CREATE INDEX IF NOT EXISTS sealed_products_seen ON sealed_products(seen_at);

CREATE TABLE IF NOT EXISTS sealed_history (
  product_id TEXT NOT NULL,
  date TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL CHECK (currency = 'EUR'),
  provider_updated_at TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (product_id, date)
);
CREATE INDEX IF NOT EXISTS sealed_history_expiry ON sealed_history(date);
