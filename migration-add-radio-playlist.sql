-- Specific hand-picked episodes featured in Listening Lair, separate
-- from radio_podcasts (which tracks whole shows browsable in full).
-- Adding an episode here also adds its parent show to radio_podcasts,
-- if it isn't already there.

CREATE TABLE IF NOT EXISTS radio_playlist_episodes (
  guid TEXT PRIMARY KEY,
  feed_url TEXT NOT NULL,
  title TEXT NOT NULL,
  audio_url TEXT,
  image TEXT,
  chapters_url TEXT,
  feed_name TEXT,
  recipient_pubkey TEXT,
  added_at INTEGER NOT NULL
);
