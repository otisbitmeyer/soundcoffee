"use client";

import { createContext, useContext, useState, useRef, useEffect, useCallback } from "react";

const PlayerContext = createContext(null);
const STORAGE_KEY = "sound-coffee-radio-queue";

/**
 * A queued track carries its full identifying metadata, not just an
 * audio URL — deliberately, so a future coordinator (the zap-split
 * radio feed design in IDEAS.md) can reference and act on real tracks
 * without this data model needing to change. Shape:
 *   { guid, title, audioUrl, image, feedTitle, feedUrl, chaptersUrl }
 */
export function PlayerProvider({ children }) {
  const [queue, setQueue] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(-1); // -1 = nothing loaded yet
  // Distinguishes "the whole featured playlist is playing" from "a
  // single episode was played individually" — same queue mechanism
  // either way, but the player's playlist-view button should only
  // ever appear for the former.
  const [isStationQueue, setIsStationQueue] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const audioRef = useRef(null);
  const pendingSeekRef = useRef(null);

  const currentTrack = currentIndex >= 0 ? queue[currentIndex] : null;

  // Load queue once on mount (not currentIndex/playing state — starting
  // paused on reload is the right default, same reasoning as the cart
  // not auto-reopening).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setQueue(JSON.parse(saved));
    } catch {
      // corrupt or unavailable storage — start with an empty queue
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
    } catch {
      // best-effort only
    }
  }, [queue, loaded]);

  const addToQueue = useCallback((track) => {
    setQueue((prev) => {
      if (prev.some((t) => t.guid === track.guid)) return prev; // no duplicates
      return [...prev, track];
    });
  }, []);

  const removeFromQueue = useCallback((guid) => {
    setQueue((prev) => {
      const index = prev.findIndex((t) => t.guid === guid);
      if (index === -1) return prev;
      const next = prev.filter((t) => t.guid !== guid);
      // Keep currentIndex pointing at the same actual track after removal.
      setCurrentIndex((ci) => {
        if (index < ci) return ci - 1;
        if (index === ci) return -1; // playing track was removed
        return ci;
      });
      return next;
    });
  }, []);

  const clearQueue = useCallback(() => {
    setQueue([]);
    setCurrentIndex(-1);
    setIsPlaying(false);
    setIsStationQueue(false);
  }, []);

  /** Replaces the entire queue with a fresh list of tracks and starts
   * playing from the first one — the actual "press play on the
   * station" mechanism, distinct from addToQueue (which appends one
   * track without disturbing whatever's already queued). */
  const playStation = useCallback((tracks) => {
    if (!tracks || tracks.length === 0) return;
    setQueue(tracks);
    setCurrentIndex(0);
    setIsPlaying(true);
    setIsStationQueue(true);
  }, []);

  /** Plays a track immediately — adds it to the queue if it isn't
   * already there, then jumps playback to it. This is how a single
   * "play this episode" click works, same as picking from a queue. */
  const playTrack = useCallback((track) => {
    setQueue((prev) => {
      const existingIndex = prev.findIndex((t) => t.guid === track.guid);
      if (existingIndex !== -1) {
        setCurrentIndex(existingIndex);
        return prev;
      }
      setCurrentIndex(prev.length);
      return [...prev, track];
    });
    setIsPlaying(true);
    setIsStationQueue(false); // a single deliberately-chosen episode, not "the playlist"
  }, []);

  /** Jumps to a specific track already in the queue by its index —
   * for selecting from the playlist dropdown while the station is
   * playing. Distinct from playTrack, which deliberately marks the
   * choice as a single separate episode rather than "still the
   * station" — this preserves isStationQueue instead of resetting it. */
  const jumpToIndex = useCallback((index) => {
    setCurrentIndex(index);
    setIsPlaying(true);
  }, []);

  const playNext = useCallback(() => {
    setCurrentIndex((ci) => {
      const next = ci + 1;
      if (next >= queue.length) {
        setIsPlaying(false);
        return ci; // stay on the last track, just stop
      }
      setIsPlaying(true);
      return next;
    });
  }, [queue.length]);

  const playPrevious = useCallback(() => {
    setCurrentIndex((ci) => {
      if (ci <= 0) return ci;
      setIsPlaying(true);
      return ci - 1;
    });
  }, []);

  const togglePlayPause = useCallback(() => {
    setIsPlaying((p) => !p);
  }, []);

  const seek = useCallback((time) => {
    pendingSeekRef.current = time;
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      pendingSeekRef.current = null;
    }
  }, []);

  // Chapter-seek support — jumps to a specific timestamp, starting
  // playback of that track if it isn't already the current one.
  const seekToChapter = useCallback(
    (track, startTime) => {
      if (currentTrack?.guid === track.guid) {
        seek(startTime);
        setIsPlaying(true);
      } else {
        pendingSeekRef.current = startTime;
        playTrack(track);
      }
    },
    [currentTrack, seek, playTrack]
  );

  // Apply a pending chapter-seek once the audio element actually has
  // the new track loaded — mirrors the same pattern used by the
  // per-episode player before this refactor.
  useEffect(() => {
    if (isPlaying && pendingSeekRef.current != null && audioRef.current) {
      const target = pendingSeekRef.current;
      pendingSeekRef.current = null;
      const applySeek = () => {
        audioRef.current.currentTime = target;
      };
      if (audioRef.current.readyState >= 1) {
        applySeek();
      } else {
        audioRef.current.addEventListener("loadedmetadata", applySeek, { once: true });
      }
    }
  }, [isPlaying, currentTrack]);

  // Sync isPlaying state to the actual <audio> element.
  useEffect(() => {
    if (!audioRef.current || !currentTrack) return;
    if (isPlaying) {
      audioRef.current.play().catch(() => setIsPlaying(false));
    } else {
      audioRef.current.pause();
    }
  }, [isPlaying, currentTrack]);

  return (
    <PlayerContext.Provider
      value={{
        queue,
        currentTrack,
        currentIndex,
        isStationQueue,
        isPlaying,
        currentTime,
        duration,
        addToQueue,
        removeFromQueue,
        clearQueue,
        playStation,
        playTrack,
        jumpToIndex,
        playNext,
        playPrevious,
        togglePlayPause,
        seek,
        seekToChapter,
      }}
    >
      {children}
      {currentTrack && (
        <audio
          ref={audioRef}
          src={currentTrack.audioUrl}
          autoPlay={isPlaying}
          onEnded={playNext}
          onTimeUpdate={(e) => setCurrentTime(e.target.currentTime)}
          onLoadedMetadata={(e) => setDuration(e.target.duration)}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          className="hidden"
        />
      )}
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used within PlayerProvider");
  return ctx;
}
