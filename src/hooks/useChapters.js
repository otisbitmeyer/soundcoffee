"use client";

import { useState } from "react";

const cache = new Map();

/**
 * Fetches a Podcast Namespace chapters file (via our own proxy, for
 * CORS) — lazily, only when load() is actually called, since most
 * episodes won't have their chapters panel opened at all.
 * Returns { chapters, loading, error, load }.
 *   chapters: array of { startTime, title, img?, url? } once loaded
 */
export function useChapters(chaptersUrl) {
  const [chapters, setChapters] = useState(cache.get(chaptersUrl)?.chapters ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  function load() {
    if (!chaptersUrl || chapters || loading) return;
    const cached = cache.get(chaptersUrl);
    if (cached) {
      setChapters(cached.chapters);
      return;
    }

    setLoading(true);
    setError(false);
    fetch(`/api/podcast-chapters?url=${encodeURIComponent(chaptersUrl)}`)
      .then((res) => res.json())
      .then((data) => {
        if (!Array.isArray(data.chapters)) {
          setError(true);
          return;
        }
        cache.set(chaptersUrl, { chapters: data.chapters });
        setChapters(data.chapters);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }

  return { chapters, loading, error, load };
}
