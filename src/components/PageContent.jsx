"use client";

import { usePlayer } from "@/context/PlayerContext";

/** Only adds bottom padding when the player bar is actually showing —
 * otherwise every page would carry empty space at the bottom even
 * when nothing's playing. */
export default function PageContent({ children }) {
  const { currentTrack } = usePlayer();
  return <div className={`flex min-h-full flex-1 flex-col ${currentTrack ? "pb-16" : ""}`}>{children}</div>;
}
