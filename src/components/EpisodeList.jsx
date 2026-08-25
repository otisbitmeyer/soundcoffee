"use client";

import { useState } from "react";
import ZapButton from "./ZapButton";
import { SOUND_COFFEE_PUBKEY } from "@/lib/identities";

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

  return (
    <div className="border-2 border-paper/30 p-6 transition hover:border-jade">
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

      <div className="mt-4 border-t border-paper/20 pt-4">
        <ZapButton
          recipientPubkey={SOUND_COFFEE_PUBKEY}
          label={`Zap: ${episode.title}`}
          className="font-display text-xs tracking-widest text-paper/60 transition hover:text-jade"
        >
          ⚡ ZAP THIS EPISODE
        </ZapButton>
      </div>
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
