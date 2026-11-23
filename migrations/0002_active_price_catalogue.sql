-- Capacity counts recently requested public cards, not every card ever looked up.
-- Archive rows/history are retained independently for up to 365 days.
CREATE INDEX IF NOT EXISTS price_cards_activity ON price_cards(last_requested_at);
