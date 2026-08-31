"use client";

import Image from "next/image";
import Header from "@/components/Header";
import EpisodeList from "@/components/EpisodeList";
import ZapButton from "@/components/ZapButton";
import { usePodcastFeed } from "@/hooks/usePodcastFeed";
import { MAIN_FEED } from "@/lib/podcastFeeds";
import { SOUND_COFFEE_PUBKEY } from "@/lib/identities";
import PwaInstallButton from "@/components/PwaInstallButton";

export default function ListeningLair() {
  // Just the one show for now — episodes go straight on this page
  // instead of behind a "pick a show" click-through. Easy to bring that
  // back if/when there's more than one show to choose between.
  const { episodes, feedInfo } = usePodcastFeed(MAIN_FEED.url);

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
              label="Boost the podcast"
              className="border-2 border-paper px-5 py-2.5 font-display text-sm tracking-widest text-paper transition hover:bg-jade hover:border-jade"
            >
              ⚡ BOOST THE PODCAST
            </ZapButton>
          </div>
        </div>

        <div className="mx-auto max-w-4xl px-6 py-16">
          {episodes ? (
            <EpisodeList episodes={episodes} showImage={feedInfo?.image} />
          ) : (
            <p className="text-center font-serif text-paper/50">Loading episodes…</p>
          )}
        </div>
      </main>

      <footer className="bg-paper">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-6 py-12 text-center">
          <Image
            src="/logo-mark.png"
            alt="Sound Coffee"
            width={578}
            height={609}
            className="h-auto w-16"
          />
          <p className="font-display text-xs tracking-widest text-ink/50">
            SOUND COFFEE &mdash; BUILT ON NOSTR
          </p>
          <PwaInstallButton />
        </div>
      </footer>
    </>
  );
}
