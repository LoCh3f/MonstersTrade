-- Confirmed catalogue slots and bounded provisional/negative entries are separate.
-- No client identifiers or personal collection data are stored.
CREATE INDEX IF NOT EXISTS price_cards_confirmed_activity
  ON price_cards(last_requested_at) WHERE payload IS NOT NULL;
CREATE INDEX IF NOT EXISTS price_cards_provisional_created
  ON price_cards(created_at) WHERE payload IS NULL;

CREATE TABLE IF NOT EXISTS price_admission_budget (
  day TEXT PRIMARY KEY,
  calls INTEGER NOT NULL CHECK (calls >= 0)
);

-- Existing unsuccessful lookups have no saved observations. Bring old negative
-- caches under the new cap without removing a refresh still holding its lease.
DELETE FROM price_cards WHERE payload IS NULL
  AND lease_until <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  AND NOT EXISTS (SELECT 1 FROM price_history WHERE price_history.card_id = price_cards.card_id)
  AND card_id IN (SELECT card_id FROM price_cards WHERE payload IS NULL ORDER BY created_at DESC, card_id LIMIT -1 OFFSET 256);
