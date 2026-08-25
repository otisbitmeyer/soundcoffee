// Every RSS feed shown on the site lives here. Today it's just Sound
// Coffee's own show — once club members can add their own podcasts/music
// via RSS, each one becomes another entry in this array, and The Listening
// Lair page will loop over all of them.
export const PODCAST_FEEDS = [
  {
    id: "sound-coffee",
    slug: "sound-coffee",
    name: "Sound Coffee",
    url: "https://serve.podhome.fm/rss/de47e794-c0a3-4bb4-8712-cce1e4566b7e",
  },
];

// Convenience: the show, for spots that only ever show Sound Coffee's own
// feed (like the homepage teaser).
export const MAIN_FEED = PODCAST_FEEDS[0];

// How many recent episodes to show in a compact list (e.g. homepage teaser).
export const TEASER_EPISODE_COUNT = 3;

