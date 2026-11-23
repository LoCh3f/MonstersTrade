-- Public catalogue/price data only. No accounts, collections, purchase costs or IP addresses.
CREATE TABLE IF NOT EXISTS price_cards (
  card_id TEXT PRIMARY KEY,
  payload TEXT,
  created_at TEXT NOT NULL,
  last_requested_at TEXT NOT NULL,
  next_refresh_at TEXT NOT NULL,
  lease_until TEXT NOT NULL DEFAULT '',
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  last_attempt_at TEXT,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS price_cards_due ON price_cards(next_refresh_at);

CREATE TABLE IF NOT EXISTS price_history (
  card_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  date TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL CHECK (currency = 'EUR'),
  metric TEXT NOT NULL,
  product_id INTEGER,
  provider_updated_at TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  mapping TEXT NOT NULL CHECK (mapping IN ('generic', 'matched')),
  PRIMARY KEY (card_id, variant_id, date),
  FOREIGN KEY (card_id) REFERENCES price_cards(card_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS price_history_expiry ON price_history(date);

CREATE TABLE IF NOT EXISTS upstream_budget (
  day TEXT PRIMARY KEY,
  calls INTEGER NOT NULL CHECK (calls >= 0)
);
