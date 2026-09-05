"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Header from "@/components/Header";
import EpisodeList from "@/components/EpisodeList";
import ZapButton from "@/components/ZapButton";
import Footer from "@/components/Footer";
import { usePlayer } from "@/context/PlayerContext";
import { usePodcastFeed } from "@/hooks/usePodcastFeed";
import { MAIN_FEED } from "@/lib/podcastFeeds";
import { SOUND_COFFEE_PUBKEY } from "@/lib/identities";

/** One row per podcast — collapsed to just its name (matching the same
 * chalkboard, click-to-expand treatment as individual episode titles),
 * expanding to that show's episode list. Fetches its own feed lazily —
 * only once actually expanded — rather than every curated show's full
 * feed loading upfront regardless of whether anyone opens it. Name is
 * uppercase and sized larger than individual episode titles, so the
 * two levels read as clearly distinct. */
function PodcastRow({ name, feedUrl, image, recipientPubkey, isOurShow }) {
  const [expanded, setExpanded] = useState(false);
  const { episodes, feedInfo } = usePodcastFeed(expanded ? feedUrl : null);

  return (
    <div>
      {isOurShow && (
        <p className="pt-6 text-center font-display text-[10px] tracking-widest text-jade">
          OUR SHOW
        </p>
      )}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full px-6 py-6 text-center transition"
      >
        <h2 className="font-serif text-3xl uppercase leading-snug tracking-wide text-paper transition hover:text-jade sm:text-4xl">
          {name}
        </h2>
      </button>

      {isOurShow && (
        <div className="flex justify-center pb-2">
          <ZapButton
            recipientPubkey={SOUND_COFFEE_PUBKEY}
            label="Boost the podcast"
            className="border-2 border-paper px-4 py-2 font-display text-xs tracking-widest text-paper transition hover:bg-jade hover:border-jade"
          >
            ⚡ BOOST THE PODCAST
          </ZapButton>
        </div>
      )}

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
  const [playlistEpisodes, setPlaylistEpisodes] = useState([]);
  const { playStation } = usePlayer();

  useEffect(() => {
    fetch("/api/radio-podcasts")
      .then((res) => res.json())
      .then((data) => setCuratedPodcasts(data.podcasts || []))
      .catch(() => setCuratedPodcasts([]));

    fetch("/api/radio-playlist")
      .then((res) => res.json())
      .then((data) => setPlaylistEpisodes(data.episodes || []))
      .catch(() => setPlaylistEpisodes([]));
  }, []);

  function handlePlayStation() {
    playStation(
      playlistEpisodes.map((e) => ({
        guid: e.guid,
        title: e.title,
        audioUrl: e.audioUrl,
        image: e.image,
        chaptersUrl: e.chaptersUrl,
        feedTitle: e.feedName,
        recipientPubkey: e.recipientPubkey || SOUND_COFFEE_PUBKEY,
      }))
    );
  }

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
        </div>

        <div className="mx-auto max-w-4xl px-6 py-16">
          {playlistEpisodes.length > 0 && (
            <div className="mb-12">
              <div className="text-center">
                <p className="font-display text-xs tracking-widest text-jade">
                  FEATURED
                </p>
                <button
                  onClick={handlePlayStation}
                  className="mt-3 border-2 border-jade bg-jade px-6 py-3 font-display text-sm tracking-widest text-ink transition hover:bg-transparent hover:text-jade"
                >
                  ▶ PLAY RADIO STATION
                </button>
              </div>
              <div className="mt-4">
                <EpisodeList
                  episodes={playlistEpisodes.map((e) => ({
                    guid: e.guid,
                    title: e.title,
                    audioUrl: e.audioUrl,
                    image: e.image,
                    chaptersUrl: e.chaptersUrl,
                  }))}
                  feedTitle="Featured"
                />
              </div>
            </div>
          )}

          <PodcastRow name="Sound Coffee" feedUrl={MAIN_FEED.url} recipientPubkey={SOUND_COFFEE_PUBKEY} isOurShow />

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
