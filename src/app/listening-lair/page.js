"use client";

import Header from "@/components/Header";
import EpisodeList from "@/components/EpisodeList";
import { usePodcastFeed } from "@/hooks/usePodcastFeed";
import { PODCAST_FEEDS } from "@/lib/podcastFeeds";

function FeedSection({ feed }) {
  const { episodes, loading, error } = usePodcastFeed(feed.url);

  return (
    <div className="border-b-4 border-paper/20 py-16 last:border-b-0">
      <h2 className="font-display text-3xl tracking-wide text-paper sm:text-4xl">
        {feed.name}
      </h2>

      {error && (
        <p className="mt-6 font-serif italic text-paper/50">
          Couldn&rsquo;t load this feed right now &mdash; check back soon.
        </p>
      )}

      {!error && (loading || !episodes) && (
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="animate-pulse border-2 border-paper/20 p-6">
              <div className="h-3 w-24 bg-paper/10" />
              <div className="mt-3 h-5 w-3/4 bg-paper/10" />
            </div>
          ))}
        </div>
      )}

      {!error && episodes && (
        <div className="mt-8">
          <EpisodeList episodes={episodes} />
        </div>
      )}
    </div>
  );
}

export default function ListeningLair() {
  return (
    <>
      <Header />

      <main className="flex-1 bg-ink text-paper">
        <div className="border-b-4 border-paper/20 px-6 py-16 sm:py-20">
          <div className="mx-auto max-w-4xl text-center">
            <h1 className="font-display text-5xl tracking-wide sm:text-6xl">
              THE LISTENING LAIR
            </h1>
            <p className="mt-4 font-serif text-lg text-paper/80">
              Every show, every voice, all in one place &mdash; starting
              with Sound Coffee itself. Club members&rsquo; own shows and
              music will land here too, straight from their own feeds.
            </p>
          </div>
        </div>

        <div className="mx-auto max-w-6xl px-6">
          {PODCAST_FEEDS.map((feed) => (
            <FeedSection key={feed.id} feed={feed} />
          ))}
        </div>
      </main>

      <footer className="bg-paper">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-6 py-12 text-center">
          <p className="font-display text-xs tracking-widest text-ink/50">
            SOUND COFFEE &mdash; BUILT ON NOSTR
          </p>
        </div>
      </footer>
    </>
  );
}
