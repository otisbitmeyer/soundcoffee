-- Explicit ordering for featured playlist episodes/tracks — previously
-- implicit (insertion order via added_at), with no way to rearrange.
ALTER TABLE radio_playlist_episodes ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

-- Backfill existing rows with their current insertion order, so
-- nothing jumps around the first time this is used.
UPDATE radio_playlist_episodes
SET sort_order = (
  SELECT COUNT(*) FROM radio_playlist_episodes AS r2
  WHERE r2.added_at <= radio_playlist_episodes.added_at
);
