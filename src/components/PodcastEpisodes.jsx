"use client";

import Link from "next/link";
import { usePodcastFeed } from "@/hooks/usePodcastFeed";
import { MAIN_FEED, TEASER_EPISODE_COUNT } from "@/lib/podcastFeeds";
import EpisodeList from "./EpisodeList";

export default function PodcastEpisodes() {
  const { episodes, loading, error } = usePodcastFeed(MAIN_FEED.url);

  if (error) {
    return (
      <p className="mt-12 font-serif italic text-paper/60">
        Couldn&rsquo;t load episodes right now &mdash; check back soon.
      </p>
    );
  }

  if (loading || !episodes) {
    return (
      <div className="mt-12 grid gap-4 sm:grid-cols-2">
        {[1, 2].map((i) => (
          <div key={i} className="animate-pulse border-2 border-paper/30 p-6">
            <div className="h-3 w-24 bg-paper/20" />
            <div className="mt-3 h-5 w-3/4 bg-paper/20" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="mt-12">
        <EpisodeList episodes={episodes} count={TEASER_EPISODE_COUNT} />
      </div>
      <div className="mt-8">
        <Link
          href="/listening-lair"
          className="inline-block border-2 border-paper px-6 py-3 font-display text-sm tracking-widest text-paper transition hover:border-jade hover:text-jade"
        >
          ENTER THE LISTENING LAIR
        </Link>
      </div>
    </>
  );
}
