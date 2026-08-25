"use client";

import Link from "next/link";
import Header from "@/components/Header";
import EpisodeList from "@/components/EpisodeList";
import { usePodcastFeed } from "@/hooks/usePodcastFeed";

export default function ShowPage({ feed }) {
  const { episodes, feedInfo, loading, error } = usePodcastFeed(feed.url);

  return (
    <>
      <Header />

      <main className="flex-1 bg-ink text-paper">
        <div className="border-b-4 border-paper/20 px-6 py-16 sm:py-20">
          <div className="mx-auto max-w-4xl text-center">
            <Link
              href="/listening-lair"
              className="font-display text-xs tracking-widest text-paper/50 hover:text-jade"
            >
              &larr; THE LISTENING LAIR
            </Link>

            {feedInfo?.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={feedInfo.image}
                alt=""
                className="mx-auto mt-6 h-28 w-28 border-2 border-paper/30 object-cover"
              />
            )}

            <h1 className="mt-6 font-display text-5xl tracking-wide sm:text-6xl">
              {feed.name}
            </h1>
            {feedInfo?.description && (
              <p className="mx-auto mt-4 max-w-2xl font-serif text-lg text-paper/80">
                {feedInfo.description}
              </p>
            )}
          </div>
        </div>

        <div className="mx-auto max-w-6xl px-6 py-16">
          {error && (
            <p className="font-serif italic text-paper/50">
              Couldn&rsquo;t load this feed right now &mdash; check back soon.
            </p>
          )}

          {!error && (loading || !episodes) && (
            <div className="grid gap-4 sm:grid-cols-2">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="animate-pulse border-2 border-paper/20 p-6">
                  <div className="h-3 w-24 bg-paper/10" />
                  <div className="mt-3 h-5 w-3/4 bg-paper/10" />
                </div>
              ))}
            </div>
          )}

          {!error && episodes && <EpisodeList episodes={episodes} />}
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
