"use client";

import { useEffect, useState } from "react";

const cache = new Map();

/**
 * Fetches and parses an RSS feed's episodes via a CORS-friendly proxy.
 * Returns { episodes, loading, error }.
 *   episodes: array of { title, link, pubDate, description, audioUrl, guid }
 */
export function usePodcastFeed(feedUrl) {
  const [episodes, setEpisodes] = useState(() => cache.get(feedUrl) ?? null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(!cache.has(feedUrl));

  useEffect(() => {
    if (!feedUrl) return;
    if (cache.has(feedUrl)) {
      setEpisodes(cache.get(feedUrl));
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(false);

    const proxyUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(
      feedUrl
    )}`;

    fetch(proxyUrl)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.status !== "ok" || !Array.isArray(data.items)) {
          setError(true);
          return;
        }
        const parsed = data.items.map((item) => ({
          title: item.title,
          link: item.link,
          pubDate: item.pubDate,
          description: item.description,
          audioUrl: item.enclosure?.link || null,
          guid: item.guid,
        }));
        cache.set(feedUrl, parsed);
        setEpisodes(parsed);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [feedUrl]);

  return { episodes, loading, error };
}
