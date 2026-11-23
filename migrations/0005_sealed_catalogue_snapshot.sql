-- One compact search snapshot replaces two full product scans per public query.
-- Products and their history remain independently addressable and unchanged.
CREATE TABLE IF NOT EXISTS sealed_catalogue (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  fetched_at TEXT,
  lease_until TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL CHECK (json_valid(payload) AND length(CAST(payload AS BLOB)) <= 1800000)
);
INSERT OR IGNORE INTO sealed_catalogue (id, fetched_at, payload)
SELECT 1, (SELECT fetched_at FROM sealed_feed WHERE id = 1),
  COALESCE((SELECT json_group_array(json_array(product_id, search_text, product_type)) FROM (
    SELECT product_id, name, search_text, product_type FROM sealed_products
    WHERE seen_at = (SELECT fetched_at FROM sealed_feed WHERE id = 1)
    ORDER BY name, product_id LIMIT 2000)), '[]');
