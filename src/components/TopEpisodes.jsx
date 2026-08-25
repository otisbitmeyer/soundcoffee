"use client";

import { useEffect, useState } from "react";
import { usePodcastFeed } from "@/hooks/usePodcastFeed";
import { MAIN_FEED } from "@/lib/podcastFeeds";
import EpisodeList from "./EpisodeList";

export default function TopEpisodes() {
  const { episodes } = usePodcastFeed(MAIN_FEED.url);
  const [ranked, setRanked] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/top-episodes?limit=4")
      .then((res) => res.json())
      .then((data) => setRanked(data.episodes))
      .catch(() => setError(true));
  }, []);

  if (error || (ranked && ranked.length === 0)) {
    return null; // nothing zapped yet — no need to show an empty section
  }

  if (!episodes || !ranked) return null;

  // Cross-reference the ranked guids against episodes we actually have
  // full details for (title, link, audio) from the feed itself.
  const topEpisodes = ranked
    .map((r) => episodes.find((ep) => ep.guid === r.episodeGuid))
    .filter(Boolean);

  if (topEpisodes.length === 0) return null;

  return (
    <div className="border-t-4 border-paper/20 py-16">
      <h2 className="font-display text-3xl tracking-wide text-paper sm:text-4xl">
        MOST ZAPPED
      </h2>
      <p className="mt-2 font-serif text-paper/60">
        The episodes that got the most love.
      </p>
      <div className="mt-8">
        <EpisodeList episodes={topEpisodes} />
      </div>
    </div>
  );
}
