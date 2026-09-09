"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Header from "@/components/Header";
import EpisodeList from "@/components/EpisodeList";
import ZapButton from "@/components/ZapButton";
import Footer from "@/components/Footer";
import { usePodcastFeed } from "@/hooks/usePodcastFeed";
import { MAIN_FEED } from "@/lib/podcastFeeds";
import { SOUND_COFFEE_PUBKEY } from "@/lib/identities";

/** One row per curated community podcast — collapsed to just its name,
 * expanding to that show's episode list. Fetches its own feed lazily —
 * only once actually expanded — rather than every curated show's full
 * feed loading upfront regardless of whether anyone opens it. Sound
 * Coffee's own show doesn't use this — its episodes show directly,
 * always expanded, no name wrapper at all. */
function PodcastRow({ name, feedUrl, image, recipientPubkey }) {
  const [expanded, setExpanded] = useState(false);
  const { episodes, feedInfo } = usePodcastFeed(expanded ? feedUrl : null);

  return (
    <div>
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full px-6 py-6 text-center transition"
      >
        <h2 className="font-serif text-3xl uppercase leading-snug tracking-wide text-paper transition hover:text-jade sm:text-4xl">
          {name}
        </h2>
      </button>

      <div
        className={`overflow-hidden transition-all duration-500 ease-in-out ${
          expanded ? "max-h-[6000px] opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <div className="border-t border-l-2 border-paper/10 border-l-jade/40 bg-paper/5 px-6 py-6">
          {episodes ? (
            <EpisodeList
              episodes={episodes}
              showImage={image || feedInfo?.image}
              feedTitle={name}
              recipientPubkey={recipientPubkey}
              paginate
            />
          ) : (
            <p className="text-center font-serif text-sm text-paper/50">Loading episodes…</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ListeningLair() {
  const [curatedPodcasts, setCuratedPodcasts] = useState([]);
  const { episodes: ourEpisodes, feedInfo: ourFeedInfo } = usePodcastFeed(MAIN_FEED.url);

  useEffect(() => {
    fetch("/api/radio-podcasts")
      .then((res) => res.json())
      .then((data) => setCuratedPodcasts(data.podcasts || []))
      .catch(() => setCuratedPodcasts([]));
  }, []);

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
            className="mx-auto mt-3 h-auto w-full max-w-xl rotate-2"
          />
          <div className="mt-6">
            <ZapButton
              recipientPubkey={SOUND_COFFEE_PUBKEY}
              label="Boost Sound Coffee"
              className="border-2 border-paper px-5 py-2.5 font-display text-sm tracking-widest text-paper transition hover:bg-jade hover:border-jade"
            >
              ⚡ BOOST SOUND COFFEE
            </ZapButton>
          </div>
        </div>

        <div className="mx-auto max-w-4xl px-6 py-16">
          {ourEpisodes ? (
            <EpisodeList
              episodes={ourEpisodes}
              showImage={ourFeedInfo?.image}
              feedTitle="Sound Coffee"
              recipientPubkey={SOUND_COFFEE_PUBKEY}
              paginate
            />
          ) : (
            <p className="text-center font-serif text-sm text-paper/50">Loading episodes…</p>
          )}

          {curatedPodcasts.length > 0 && (
            <p className="mt-10 mb-2 border-t border-paper/10 pt-8 text-center font-display text-xs tracking-widest text-rust">
              FROM THE COMMUNITY
            </p>
          )}
          {curatedPodcasts.map((p) => (
            <PodcastRow
              key={p.feedUrl}
              name={p.name}
              feedUrl={p.feedUrl}
              image={p.image}
              recipientPubkey={p.recipientPubkey}
            />
          ))}
        </div>
      </main>

      <Footer />
    </>
  );
}
