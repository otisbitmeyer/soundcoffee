"use client";

import { useEffect, useState } from "react";

const cache = new Map();

/**
 * Fetches and parses an RSS feed's episodes via a CORS-friendly proxy.
 * Returns { episodes, feedInfo, loading, error }.
 *   episodes: array of { title, link, pubDate, description, audioUrl, guid }
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

    const proxyUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(
      feedUrl
    )}&count=100`;

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
        const info = {
          title: data.feed?.title,
          description: data.feed?.description,
          image: data.feed?.image,
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
