-- Log of who actually used each discount code, not just a running
-- count — one row per redemption.
CREATE TABLE IF NOT EXISTS discount_code_uses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  buyer_pubkey TEXT,
  order_id TEXT,
  used_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_discount_uses_code ON discount_code_uses(code);
