-- Distinguishes a podcast episode (which auto-curates its parent show
-- into radio_podcasts) from a music track (which doesn't — added
-- explicitly so music never ends up in the browsable podcast list).
ALTER TABLE radio_playlist_episodes ADD COLUMN track_type TEXT NOT NULL DEFAULT 'podcast_episode';
