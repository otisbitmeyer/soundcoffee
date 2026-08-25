"use client";

import Image from "next/image";
import Link from "next/link";
import Header from "@/components/Header";
import { usePodcastFeed } from "@/hooks/usePodcastFeed";
import { PODCAST_FEEDS } from "@/lib/podcastFeeds";

function ShowCard({ feed }) {
  const { feedInfo, episodes } = usePodcastFeed(feed.url);

  return (
    <Link
      href={`/listening-lair/${feed.slug}`}
      className="group flex items-center gap-6 border-2 border-paper/30 p-6 transition hover:border-jade"
    >
      {feedInfo?.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={feedInfo.image}
          alt=""
          className="h-20 w-20 shrink-0 border-2 border-paper/30 object-cover"
        />
      )}
      <div>
        <h2 className="font-display text-2xl tracking-wide">{feed.name}</h2>
        <p className="mt-1 font-serif text-sm text-paper/60">
          {episodes ? `${episodes.length} episodes` : "Loading…"}
        </p>
      </div>
      <span className="ml-auto shrink-0 font-display text-sm tracking-widest text-paper/40 group-hover:text-jade">
        ENTER &rarr;
      </span>
    </Link>
  );
}

export default function ListeningLair() {
  return (
    <>
      <Header />

      <main className="flex-1 bg-ink text-paper">
        <div className="border-b-4 border-paper/20 px-6 py-12 text-center sm:py-14">
          <h1 className="font-display text-5xl tracking-wide sm:text-6xl">
            THE LISTENING LAIR
          </h1>
          <Image
            src="/listening-lair-graphic-v2.png"
            alt="Conversations in the coffee shop."
            width={1532}
            height={156}
            className="mx-auto -mt-2 h-auto w-full max-w-xl"
          />
        </div>

        <div className="mx-auto max-w-3xl px-6 py-16">
          <div className="space-y-4">
            {PODCAST_FEEDS.map((feed) => (
              <ShowCard key={feed.id} feed={feed} />
            ))}
          </div>
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
