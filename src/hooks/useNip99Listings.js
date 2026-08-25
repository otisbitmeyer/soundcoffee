"use client";

import { useEffect, useState } from "react";
import { SimplePool } from "nostr-tools/pool";
import { DEFAULT_RELAYS } from "@/lib/relays";

let pool;
function getPool() {
  if (!pool) pool = new SimplePool();
  return pool;
}

function getTag(event, name) {
  const t = event.tags.find((t) => t[0] === name);
  return t ? t[1] : undefined;
}

function getAllTags(event, name) {
  return event.tags.filter((t) => t[0] === name);
}

function parseListing(event) {
  const dTag = getTag(event, "d") || event.id;
  const priceTag = event.tags.find((t) => t[0] === "price");
  const images = getAllTags(event, "image").map((t) => t[1]);

  return {
    id: event.id,
    pubkey: event.pubkey,
    dTag,
    coordinate: `30402:${event.pubkey}:${dTag}`,
    title: getTag(event, "title") || "Untitled listing",
    summary: getTag(event, "summary") || "",
    content: event.content,
    status: getTag(event, "status") || "active",
    publishedAt: getTag(event, "published_at"),
    location: getTag(event, "location"),
    price: priceTag
      ? { amount: priceTag[1], currency: priceTag[2], frequency: priceTag[3] }
      : null,
    images,
    hashtags: getAllTags(event, "t").map((t) => t[1]),
    createdAt: event.created_at,
  };
}

/**
 * Fetches NIP-99 (kind 30402) product listings authored by `pubkey`,
 * filters out anything covered by a NIP-09 (kind 5) deletion event, and
 * keeps only the latest version of each addressable listing (by "d" tag).
 */
export function useNip99Listings(pubkey) {
  const [listings, setListings] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!pubkey) return;
    let cancelled = false;

    async function load() {
      try {
        const p = getPool();

        const [listingEvents, deletionEvents] = await Promise.all([
          p.querySync(DEFAULT_RELAYS, { kinds: [30402], authors: [pubkey] }),
          p.querySync(DEFAULT_RELAYS, { kinds: [5], authors: [pubkey] }),
        ]);

        if (cancelled) return;

        // Collect everything a deletion event says to remove: either a
        // specific event id ("e" tag) or an addressable coordinate ("a" tag).
        const deletedIds = new Set();
        const deletedCoords = new Set();
        for (const del of deletionEvents) {
          for (const tag of del.tags) {
            if (tag[0] === "e") deletedIds.add(tag[1]);
            if (tag[0] === "a") deletedCoords.add(tag[1]);
          }
        }

        // Keep only the newest event per "d" tag (addressable events can
        // have stale copies floating around on some relays).
        const latestByDTag = new Map();
        for (const event of listingEvents) {
          const d = getTag(event, "d") || event.id;
          const existing = latestByDTag.get(d);
          if (!existing || event.created_at > existing.created_at) {
            latestByDTag.set(d, event);
          }
        }

        const active = [...latestByDTag.values()]
          .filter((event) => {
            const d = getTag(event, "d") || event.id;
            const coord = `30402:${event.pubkey}:${d}`;
            return !deletedIds.has(event.id) && !deletedCoords.has(coord);
          })
          .map(parseListing)
          .sort((a, b) => b.createdAt - a.createdAt);

        setListings(active);
      } catch {
        if (!cancelled) setError(true);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [pubkey]);

  return { listings, loading: listings === null && !error, error };
}
