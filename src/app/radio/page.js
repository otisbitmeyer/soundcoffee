"use client";

import Header from "@/components/Header";
import { usePlayer } from "@/context/PlayerContext";
import { usePodcastFeed } from "@/hooks/usePodcastFeed";
import { PODCAST_FEEDS } from "@/lib/podcastFeeds";

function FeedEpisodeList({ feed }) {
  const { episodes, feedInfo } = usePodcastFeed(feed.url);
  const { queue, addToQueue } = usePlayer();

  if (!episodes) {
    return <p className="font-serif text-sm text-paper/50">Loading {feed.name}…</p>;
  }

  return (
    <div>
      <h2 className="font-display text-lg tracking-widest text-jade">{feed.name}</h2>
      <div className="mt-3 divide-y divide-paper/10 border border-paper/20">
        {episodes.map((ep) => {
          const inQueue = queue.some((t) => t.guid === ep.guid);
          return (
            <div key={ep.guid} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                {(ep.image || feedInfo?.image) && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={ep.image || feedInfo?.image}
                    alt=""
                    className="h-10 w-10 shrink-0 border border-paper/20 object-cover"
                  />
                )}
                <p className="truncate font-serif text-sm text-paper/90">{ep.title}</p>
              </div>
              <button
                onClick={() =>
                  addToQueue({
                    guid: ep.guid,
                    title: ep.title,
                    audioUrl: ep.audioUrl,
                    image: ep.image || feedInfo?.image || null,
                    feedTitle: feed.name,
                    chaptersUrl: ep.chaptersUrl || null,
                    link: ep.link,
                  })
                }
                disabled={inQueue || !ep.audioUrl}
                className="shrink-0 border-2 border-paper/40 px-3 py-1.5 font-display text-xs tracking-widest text-paper transition hover:border-jade hover:text-jade disabled:opacity-30"
              >
                {inQueue ? "QUEUED" : "+ QUEUE"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function QueuePanel() {
  const { queue, currentTrack, playTrack, removeFromQueue, clearQueue } = usePlayer();

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg tracking-widest text-jade">
          QUEUE ({queue.length})
        </h2>
        {queue.length > 0 && (
          <button
            onClick={clearQueue}
            className="font-display text-xs tracking-widest text-rust hover:text-paper"
          >
            CLEAR
          </button>
        )}
      </div>

      {queue.length === 0 ? (
        <p className="mt-3 font-serif text-sm italic text-paper/40">
          Nothing queued yet — add episodes below to build your station.
        </p>
      ) : (
        <div className="mt-3 divide-y divide-paper/10 border border-paper/20">
          {queue.map((track) => (
            <div
              key={track.guid}
              className={`flex items-center justify-between gap-3 px-4 py-3 ${
                currentTrack?.guid === track.guid ? "bg-jade/10" : ""
              }`}
            >
              <button
                onClick={() => playTrack(track)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                {track.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={track.image} alt="" className="h-10 w-10 shrink-0 border border-paper/20 object-cover" />
                )}
                <div className="min-w-0">
                  <p className="truncate font-serif text-sm text-paper/90">{track.title}</p>
                  {track.feedTitle && (
                    <p className="truncate font-display text-[10px] tracking-widest text-paper/40">
                      {track.feedTitle}
                    </p>
                  )}
                </div>
              </button>
              <button
                onClick={() => removeFromQueue(track.guid)}
                aria-label="Remove from queue"
                className="shrink-0 font-display text-lg text-paper/40 hover:text-rust"
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Radio() {
  return (
    <>
      <Header />

      <main className="flex-1 bg-ink text-paper">
        <div className="mx-auto max-w-3xl px-6 py-16">
          <h1 className="text-center font-display text-4xl tracking-wide sm:text-5xl">
            RADIO
          </h1>
          <p className="mt-3 text-center font-serif text-paper/60">
            Build your own station — queue up episodes and they&rsquo;ll
            play back-to-back.
          </p>

          <div className="mt-10">
            <QueuePanel />
          </div>

          <div className="mt-12 space-y-10">
            {PODCAST_FEEDS.map((feed) => (
              <FeedEpisodeList key={feed.id} feed={feed} />
            ))}
          </div>
        </div>
      </main>
    </>
  );
}
