-- Podcasts curated into the site's one radio feed, shown in Listening
-- Lair alongside Sound Coffee's own show. Admin-only to add/remove —
-- not a public, guest-built queue.

CREATE TABLE IF NOT EXISTS radio_podcasts (
  feed_url TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  recipient_pubkey TEXT,   -- optional — hex pubkey to zap for this show's episodes
  image TEXT,
  added_at INTEGER NOT NULL
);
