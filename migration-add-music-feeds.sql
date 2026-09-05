-- Music feeds curated for repeat access when adding songs to the
-- featured playlist — deliberately separate from radio_podcasts, so
-- these never show up in Listening Lair's browsable podcast list.
-- Purely an admin-side convenience list.

CREATE TABLE IF NOT EXISTS radio_music_feeds (
  feed_url TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  recipient_pubkey TEXT,
  image TEXT,
  added_at INTEGER NOT NULL
);
