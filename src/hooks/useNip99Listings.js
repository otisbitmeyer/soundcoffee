"use client";

import { useEffect, useState } from "react";
import { SimplePool } from "nostr-tools/pool";
import { DEFAULT_RELAYS } from "@/lib/relays";

let pool;
function getPool() {
  if (!pool) pool = new SimplePool();
  return pool;
}

export function getTag(event, name) {
  const t = event.tags.find((t) => t[0] === name);
  return t ? t[1] : undefined;
}

export function getAllTags(event, name) {
  return event.tags.filter((t) => t[0] === name);
}

export function parseListing(event) {
  const dTag = getTag(event, "d") || event.id;
  const priceTag = event.tags.find((t) => t[0] === "price");
  const images = getAllTags(event, "image").map((t) => t[1]);
  const typeTag = event.tags.find((t) => t[0] === "type");
  const shippingOptionCoords = event.tags
    .filter((t) => t[0] === "shipping_option")
    .map((t) => t[1]);

  // Gamma spec's "spec" tag: ["spec", "<key>", "<value>"], may repeat —
  // this is where variation attributes like size/color live, since the
  // spec doesn't have dedicated fields for them.
  const specs = {};
  for (const t of getAllTags(event, "spec")) {
    if (t[1]) specs[t[1]] = t[2] || "";
  }

  // For a "variation" listing, the "a" tag (product reference format)
  // points back at its "variable" parent's coordinate.
  const parentCoordinate = event.tags.find(
    (t) => t[0] === "a" && t[1]?.startsWith("30402:")
  )?.[1];

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
    // Gamma Markets NIP-99 e-commerce extension: ["type", "<simple|variable|variation>", "<digital|physical>"]
    productType: typeTag?.[1] || "simple",
    format: typeTag?.[2] || "digital",
    shippingOptionCoords,
    specs,
    parentCoordinate,
    images,
    hashtags: getAllTags(event, "t").map((t) => t[1]),
    createdAt: event.created_at,
  };
}

/**
 * Fetches NIP-99 (kind 30402) product listings authored by `pubkey`,
 * filters out anything covered by a NIP-09 (kind 5) deletion event, and
 * keeps only the latest version of each addressable listing (by "d" tag).
 *
 * Returns both `listings` (top-level items to show in a grid — "simple"
 * and "variable" products, but not their "variation" children, which
 * shouldn't appear as their own cards) and `allListings` (everything,
 * including variations — used to look up a "variable" product's options
 * without a second relay round-trip).
 */
export function useNip99Listings(pubkey) {
  const [allListings, setAllListings] = useState(null);
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

        setAllListings(active);
      } catch {
        if (!cancelled) setError(true);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [pubkey]);

  const listings = allListings?.filter((l) => l.productType !== "variation") ?? null;

  return {
    listings,
    allListings,
    loading: allListings === null && !error,
    error,
  };
}

/** Given the full listing set, finds the variations belonging to a "variable" parent. */
export function getVariationsOf(allListings, parentCoordinate) {
  return (allListings || []).filter(
    (l) => l.productType === "variation" && l.parentCoordinate === parentCoordinate
  );
}
