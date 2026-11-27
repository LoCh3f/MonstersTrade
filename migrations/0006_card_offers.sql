CREATE TABLE card_offers (
  blueprint_id INTEGER NOT NULL,
  language TEXT NOT NULL,
  payload TEXT,
  next_refresh_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (blueprint_id, language)
) WITHOUT ROWID;
