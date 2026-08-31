"use client";

import { useEffect, useState } from "react";

const cache = new Map();

/**
 * Fetches and parses an RSS feed's episodes via a CORS-friendly proxy.
 * Returns { episodes, feedInfo, loading, error }.
 *   episodes: array of { title, link, pubDate, description, audioUrl, guid, chaptersUrl }
 *   feedInfo: { title, description, image } for the show itself
 */
export function usePodcastFeed(feedUrl) {
  const cached = cache.get(feedUrl);
  const [episodes, setEpisodes] = useState(cached?.episodes ?? null);
  const [feedInfo, setFeedInfo] = useState(cached?.feedInfo ?? null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(!cache.has(feedUrl));

  useEffect(() => {
    if (!feedUrl) return;
    if (cache.has(feedUrl)) {
      const c = cache.get(feedUrl);
      setEpisodes(c.episodes);
      setFeedInfo(c.feedInfo);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(false);

    // Our own feed proxy — replaces rss2json, whose free tier turned out
    // to be unreliable (rejects requests above its default item count,
    // and rate-limits aggressively even at the default). No artificial
    // caps, no third-party dependency in the request path.
    const proxyUrl = `/api/podcast-feed?url=${encodeURIComponent(feedUrl)}`;

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
          audioUrl: item.audioUrl || null,
          guid: item.guid,
          chaptersUrl: item.chaptersUrl || null,
        }));
        const info = {
          title: data.feedInfo?.title,
          description: data.feedInfo?.description,
          image: data.feedInfo?.image,
        };
        cache.set(feedUrl, { episodes: parsed, feedInfo: info });
        setEpisodes(parsed);
        setFeedInfo(info);
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

  return { episodes, feedInfo, loading, error };
}
