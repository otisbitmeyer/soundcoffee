-- Sound Coffee order/inventory database. This is now the authoritative
-- source for orders and stock — Nostr NIP-99 listings remain the public
-- storefront, but never the source of truth for "did this actually sell"
-- or "how many are left." That ambiguity was the root of the duplicate
-- orders and unreliable payment status problems.

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,               -- same id used as the NIP-17 "order" tag, when applicable
  customer_pubkey TEXT,              -- nullable — not every order has a Nostr identity attached
  customer_email TEXT,
  payment_method TEXT NOT NULL,      -- 'lightning' | 'card'
  payment_status TEXT NOT NULL DEFAULT 'pending',   -- 'pending' | 'paid' | 'failed' | 'refunded'
  fulfillment_status TEXT NOT NULL DEFAULT 'unfulfilled', -- 'unfulfilled' | 'shipped' | 'delivered' | 'cancelled'
  amount_sats INTEGER,
  amount_usd_cents INTEGER,
  items_json TEXT NOT NULL,          -- [{coordinate, quantity, title}]
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  country TEXT,
  phone TEXT,
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'soundcoffee.org', -- where the order came from
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);

CREATE TABLE IF NOT EXISTS inventory (
  product_coordinate TEXT PRIMARY KEY,  -- "30402:<pubkey>:<d-tag>"
  title TEXT,
  stock INTEGER,                        -- NULL = unlimited/not tracked
  updated_at INTEGER NOT NULL,
  synced_to_nostr_at INTEGER             -- last time the public listing reflected this stock number
);

CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  product_coordinate TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'reserved',  -- 'reserved' | 'committed' | 'released'
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status);
CREATE INDEX IF NOT EXISTS idx_reservations_expires ON reservations(expires_at);
