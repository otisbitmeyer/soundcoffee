"use client";

import { useEffect, useState, useCallback } from "react";

/**
 * Fetches zap totals + individual comment entries for one podcast
 * episode (keyed by its RSS guid). Returns a `refresh` function so the
 * UI can pull fresh data right after someone zaps, without waiting for a
 * full page reload.
 */
export function useEpisodeZaps(episodeGuid) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(!!episodeGuid);
  const [error, setError] = useState(false);

  const refresh = useCallback(() => {
    if (!episodeGuid) return;
    setLoading(true);
    fetch(`/api/episode-zaps?guid=${encodeURIComponent(episodeGuid)}`)
      .then((res) => res.json())
      .then((json) => {
        setData(json);
        setError(false);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [episodeGuid]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { data, loading, error, refresh };
}
