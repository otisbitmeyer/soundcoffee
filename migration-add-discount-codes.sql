-- Discount codes — applied at checkout, before either payment method
-- (Lightning or card) is invoked, so the discount is reflected in
-- whichever total actually gets charged either way.

CREATE TABLE IF NOT EXISTS discount_codes (
  code TEXT PRIMARY KEY,                 -- entered by the buyer, case-insensitive (stored uppercase)
  discount_type TEXT NOT NULL,           -- 'percent' | 'flat_usd'
  discount_value REAL NOT NULL,          -- e.g. 10 for 10%, or 5 for $5 off
  allowed_npubs TEXT,                    -- JSON array of hex pubkeys; NULL = anyone can use it
  active INTEGER NOT NULL DEFAULT 1,
  uses_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
