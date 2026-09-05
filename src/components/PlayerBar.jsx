"use client";

import { useState } from "react";
import { usePlayer } from "@/context/PlayerContext";
import { useEpisodeNote } from "@/hooks/useEpisodeNote";
import { useChapters } from "@/hooks/useChapters";
import ZapButton from "./ZapButton";

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatChapterTime(seconds) {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${mm}:${ss}`;
}

export default function PlayerBar() {
  const {
    currentTrack,
    queue,
    currentIndex,
    isPlaying,
    currentTime,
    duration,
    togglePlayPause,
    playNext,
    playPrevious,
    seek,
  } = usePlayer();

  const [chaptersOpen, setChaptersOpen] = useState(false);
  // Only fetch a note/chapters at all once there's actually a track loaded —
  // hooks still need to be called unconditionally, so guard the argument
  // instead of the call itself.
  const { noteId } = useEpisodeNote(currentTrack?.guid);
  const { chapters, loading: chaptersLoading, load: loadChapters } = useChapters(
    currentTrack?.chaptersUrl
  );

  if (!currentTrack) return null;

  const hasNext = currentIndex < queue.length - 1;
  const hasPrevious = currentIndex > 0;
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  function toggleChapters() {
    if (!chaptersOpen) loadChapters();
    setChaptersOpen((o) => !o);
  }

  function skip(deltaSeconds) {
    seek(Math.max(0, Math.min(duration || 0, currentTime + deltaSeconds)));
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-[130] border-t-2 border-ink bg-ink text-paper">
      {chaptersOpen && (
        <div className="max-h-64 overflow-y-auto border-b border-paper/20 px-4 py-3 sm:px-6">
          {chaptersLoading && (
            <p className="font-serif text-xs text-paper/50">Loading chapters…</p>
          )}
          {!chaptersLoading && chapters?.length > 0 && (
            <ul className="space-y-1.5">
              {chapters.map((ch, i) => (
                <li key={i}>
                  <button
                    onClick={() => {
                      seek(ch.startTime);
                      setChaptersOpen(false);
                    }}
                    className="flex w-full items-baseline gap-3 text-left font-serif text-sm text-paper/80 hover:text-jade"
                  >
                    <span className="shrink-0 font-mono text-xs text-jade/70">
                      {formatChapterTime(ch.startTime)}
                    </span>
                    {ch.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!chaptersLoading && chapters?.length === 0 && (
            <p className="font-serif text-xs italic text-paper/40">
              No chapters for this episode.
            </p>
          )}
        </div>
      )}

      <div
        className="h-1 cursor-pointer bg-paper/10"
        onClick={(e) => {
          if (!duration) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = (e.clientX - rect.left) / rect.width;
          seek(ratio * duration);
        }}
      >
        <div className="h-full bg-jade" style={{ width: `${progress}%` }} />
      </div>

      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5 sm:gap-4 sm:px-6">
        {currentTrack.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={currentTrack.image}
            alt=""
            className="hidden h-10 w-10 shrink-0 border border-paper/30 object-cover sm:block"
          />
        )}

        <div className="min-w-0 flex-1">
          <p className="truncate font-serif text-sm text-paper">{currentTrack.title}</p>
          {currentTrack.feedTitle && (
            <p className="truncate font-display text-[10px] tracking-widest text-paper/40">
              {currentTrack.feedTitle}
            </p>
          )}
        </div>

        <span className="hidden shrink-0 font-mono text-xs text-paper/50 md:inline">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <button
            onClick={playPrevious}
            disabled={!hasPrevious}
            aria-label="Previous track"
            title="Previous track in queue"
            className="hidden text-paper/60 transition hover:text-jade disabled:opacity-30 disabled:hover:text-paper/60 sm:inline"
          >
            ⏮
          </button>
          <button
            onClick={() => skip(-30)}
            aria-label="Rewind 30 seconds"
            title="Rewind 30 seconds"
            className="font-mono text-xs text-paper/60 transition hover:text-jade"
          >
            ◂30
          </button>
          <button
            onClick={togglePlayPause}
            aria-label={isPlaying ? "Pause" : "Play"}
            className="border-2 border-paper/50 px-3 py-1.5 font-display text-sm tracking-widest text-paper transition hover:border-jade hover:text-jade"
          >
            {isPlaying ? "PAUSE" : "PLAY"}
          </button>
          <button
            onClick={() => skip(30)}
            aria-label="Forward 30 seconds"
            title="Forward 30 seconds"
            className="font-mono text-xs text-paper/60 transition hover:text-jade"
          >
            30▸
          </button>
          <button
            onClick={playNext}
            disabled={!hasNext}
            aria-label="Next track"
            title="Next track in queue"
            className="hidden text-paper/60 transition hover:text-jade disabled:opacity-30 disabled:hover:text-paper/60 sm:inline"
          >
            ⏭
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-2 border-l border-paper/20 pl-3 sm:gap-3">
          {currentTrack.chaptersUrl && (
            <button
              onClick={toggleChapters}
              aria-label="Chapters"
              title="Chapters"
              className={`font-display text-xs tracking-widest transition ${
                chaptersOpen ? "text-jade" : "text-paper/60 hover:text-jade"
              }`}
            >
              CH
            </button>
          )}
          {currentTrack.guid && (
            <ZapButton
              recipientPubkey={currentTrack.recipientPubkey}
              label={`Zap: ${currentTrack.title}`}
              episodeGuid={currentTrack.guid}
              eventId={noteId || undefined}
              className="font-display text-xs tracking-widest text-jade transition hover:text-paper"
            >
              ⚡
            </ZapButton>
          )}
        </div>
      </div>
    </div>
  );
}
