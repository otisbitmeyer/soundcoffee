"use client";

import { useState } from "react";
import { SimplePool } from "nostr-tools/pool";
import ZapButton from "./ZapButton";
import EpisodeComments from "./EpisodeComments";
import { useEpisodeZaps } from "@/hooks/useEpisodeZaps";
import { useEpisodeNote } from "@/hooks/useEpisodeNote";
import { useAuth } from "@/context/AuthContext";
import { episodeExternalId } from "@/lib/episodeId";
import { DEFAULT_RELAYS } from "@/lib/relays";
import { SOUND_COFFEE_PUBKEY } from "@/lib/identities";

let publishPool;
function getPublishPool() {
  if (!publishPool) publishPool = new SimplePool();
  return publishPool;
}

function formatDate(dateString) {
  try {
    return new Date(dateString).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

function EpisodeCard({ episode }) {
  const [playing, setPlaying] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const { data, loading, refresh } = useEpisodeZaps(episode.guid);
  const { noteId, loading: noteLoading, refresh: refreshNote } = useEpisodeNote(episode.guid);
  const { pubkey, signEvent } = useAuth();
  const isSoundCoffeeAccount = pubkey === SOUND_COFFEE_PUBKEY;

  async function handlePublishNote() {
    setPublishing(true);
    try {
      const template = {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["i", episodeExternalId(episode.guid)]],
        content: `🎙️ New episode: "${episode.title}"\n\n${episode.link}`,
      };
      const signed = await signEvent(template);
      await Promise.any(getPublishPool().publish(DEFAULT_RELAYS, signed));
      refreshNote();
    } catch {
      // best-effort — the zap flow still works fine without a note,
      // it just won't show comments as prominently in other clients
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="border-2 border-paper/30 transition hover:border-jade">
      <div className="p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <span className="font-display text-sm tracking-widest text-jade">
              {formatDate(episode.pubDate)}
            </span>
            <h3 className="mt-2 font-display text-xl">{episode.title}</h3>
          </div>

          {episode.audioUrl ? (
            <button
              onClick={() => setPlaying((p) => !p)}
              className="shrink-0 border-2 border-paper/50 px-4 py-2 font-display text-sm tracking-widest text-paper transition hover:border-jade hover:text-jade"
            >
              {playing ? "CLOSE" : "PLAY ▸"}
            </button>
          ) : (
            <a
              href={episode.link}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 font-display text-sm tracking-widest text-paper/50 hover:text-jade"
            >
              LISTEN &rarr;
            </a>
          )}
        </div>

        {playing && episode.audioUrl && (
          <audio
            controls
            autoPlay
            src={episode.audioUrl}
            className="mt-4 w-full"
          >
            Your browser doesn&rsquo;t support inline audio.{" "}
            <a href={episode.link}>Listen on the episode page instead.</a>
          </audio>
        )}
      </div>

      {episode.guid && (
        <>
          <div className="flex items-center justify-between border-t border-paper/20 px-6 py-3">
            <div className="flex items-center gap-4">
              <ZapButton
                recipientPubkey={SOUND_COFFEE_PUBKEY}
                label={`Zap: ${episode.title}`}
                episodeGuid={episode.guid}
                eventId={noteId || undefined}
                onZapped={refresh}
                className="font-display text-xs tracking-widest text-jade transition hover:text-paper"
              >
                ⚡ ZAP
              </ZapButton>
              <button
                onClick={() => setCommentsOpen((o) => !o)}
                className="font-display text-xs tracking-widest text-paper/60 transition hover:text-jade"
              >
                ZAPS AND CONVERSATION {commentsOpen ? "▲" : "▼"}
              </button>
              {isSoundCoffeeAccount && !noteLoading && !noteId && (
                <button
                  onClick={handlePublishNote}
                  disabled={publishing}
                  title="Publishes a Nostr note for this episode so zap comments show up clearly in other clients"
                  className="font-display text-xs tracking-widest text-rust transition hover:text-paper disabled:opacity-50"
                >
                  {publishing ? "PUBLISHING…" : "📝 PUBLISH NOTE"}
                </button>
              )}
            </div>

            {!loading && data && data.count > 0 && (
              <span className="inline-block min-w-[92px] border border-paper/20 px-2 py-1 text-right font-serif text-xs text-paper/50">
                {data.count} zap{data.count === 1 ? "" : "s"}
                <br />
                {data.totalSats.toLocaleString()} sats
              </span>
            )}
          </div>

          {commentsOpen && <EpisodeComments data={data} loading={loading} />}
        </>
      )}
    </div>
  );
}

export default function EpisodeList({ episodes, count }) {
  const list = count ? episodes.slice(0, count) : episodes;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {list.map((ep, i) => (
        <EpisodeCard key={ep.guid || i} episode={ep} />
      ))}
    </div>
  );
}
