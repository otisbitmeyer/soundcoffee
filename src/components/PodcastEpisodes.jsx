"use client";

import { useEffect, useState } from "react";
import { PODCAST_FEED_URL, EPISODE_COUNT } from "@/lib/podcastFeed";

function formatDate(dateString) {
  try {
    return new Date(dateString).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

export default function PodcastEpisodes() {
  const [episodes, setEpisodes] = useState(null); // null = loading
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // rss2json is a free, no-signup proxy that fetches an RSS feed
    // server-side and hands it back as JSON — needed because browsers
    // block direct cross-site RSS fetches (most podcast hosts don't set
    // the CORS headers required for a plain fetch() to work).
    const proxyUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(
      PODCAST_FEED_URL
    )}`;

    fetch(proxyUrl)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.status !== "ok" || !Array.isArray(data.items)) {
          setError(true);
          return;
        }
        setEpisodes(data.items.slice(0, EPISODE_COUNT));
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <p className="mt-12 font-serif italic text-paper/60">
        Couldn&rsquo;t load episodes right now &mdash; check back soon.
      </p>
    );
  }

  if (!episodes) {
    return (
      <div className="mt-12 grid gap-4 sm:grid-cols-2">
        {[1, 2].map((i) => (
          <div
            key={i}
            className="animate-pulse border-2 border-paper/30 p-6"
          >
            <div className="h-3 w-24 bg-paper/20" />
            <div className="mt-3 h-5 w-3/4 bg-paper/20" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="mt-12 grid gap-4 sm:grid-cols-2">
      {episodes.map((ep, i) => (
        <a
          key={ep.guid || i}
          href={ep.link}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between gap-4 border-2 border-paper/30 p-6 transition hover:border-jade"
        >
          <div>
            <span className="font-display text-sm tracking-widest text-jade">
              {formatDate(ep.pubDate)}
            </span>
            <h3 className="mt-2 font-display text-xl">{ep.title}</h3>
          </div>
          <span className="shrink-0 font-display text-sm tracking-widest text-paper/50">
            PLAY &rarr;
          </span>
        </a>
      ))}
    </div>
  );
}
