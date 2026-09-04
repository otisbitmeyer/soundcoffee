"use client";

import { usePlayer } from "@/context/PlayerContext";

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
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

  if (!currentTrack) return null;

  const hasNext = currentIndex < queue.length - 1;
  const hasPrevious = currentIndex > 0;
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[130] border-t-2 border-ink bg-ink text-paper">
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

      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-2.5 sm:px-6">
        {currentTrack.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={currentTrack.image}
            alt=""
            className="h-10 w-10 shrink-0 border border-paper/30 object-cover"
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

        <span className="hidden shrink-0 font-mono text-xs text-paper/50 sm:inline">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>

        <div className="flex shrink-0 items-center gap-3">
          <button
            onClick={playPrevious}
            disabled={!hasPrevious}
            aria-label="Previous"
            className="text-paper/60 transition hover:text-jade disabled:opacity-30 disabled:hover:text-paper/60"
          >
            ◂◂
          </button>
          <button
            onClick={togglePlayPause}
            aria-label={isPlaying ? "Pause" : "Play"}
            className="border-2 border-paper/50 px-3 py-1.5 font-display text-sm tracking-widest text-paper transition hover:border-jade hover:text-jade"
          >
            {isPlaying ? "PAUSE" : "PLAY"}
          </button>
          <button
            onClick={playNext}
            disabled={!hasNext}
            aria-label="Next"
            className="text-paper/60 transition hover:text-jade disabled:opacity-30 disabled:hover:text-paper/60"
          >
            ▸▸
          </button>
        </div>
      </div>
    </div>
  );
}
