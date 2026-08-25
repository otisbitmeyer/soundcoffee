"use client";

import { useEffect, useState, useCallback } from "react";
import { SimplePool } from "nostr-tools/pool";
import { DEFAULT_RELAYS } from "@/lib/relays";
import { episodeExternalId } from "@/lib/episodeId";
import { SOUND_COFFEE_PUBKEY } from "@/lib/identities";

let pool;
function getPool() {
  if (!pool) pool = new SimplePool();
  return pool;
}

/**
 * Looks up whether a real Nostr note (kind 1) has been published for a
 * given episode — found via the same "i" tag convention used for zaps.
 * If one exists, its event id becomes the natural thing to zap (an "e"
 * tag), which is what makes other Nostr clients actually display the
 * zap comment prominently — a bare profile zap has nowhere for most
 * clients to show that context.
 */
export function useEpisodeNote(episodeGuid) {
  const [noteId, setNoteId] = useState(null);
  const [loading, setLoading] = useState(!!episodeGuid);

  const refresh = useCallback(() => {
    if (!episodeGuid) return;
    setLoading(true);
    getPool()
      .get(DEFAULT_RELAYS, {
        kinds: [1],
        authors: [SOUND_COFFEE_PUBKEY],
        "#i": [episodeExternalId(episodeGuid)],
      })
      .then((event) => setNoteId(event?.id || null))
      .catch(() => setNoteId(null))
      .finally(() => setLoading(false));
  }, [episodeGuid]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { noteId, loading, refresh };
}
