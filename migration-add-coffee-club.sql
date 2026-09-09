-- Coffee Club members — membership automatically entitles a buyer to
-- a discount at checkout, recognized by their logged-in pubkey, no
-- code needed. discount_percent is per-member from day one (even
-- though every member gets the same value today, set from one global
-- default) so per-member flexibility later needs no schema change.

CREATE TABLE IF NOT EXISTS coffee_club_members (
  pubkey TEXT PRIMARY KEY,
  discount_percent REAL NOT NULL,
  notes TEXT,
  joined_at INTEGER NOT NULL
);
