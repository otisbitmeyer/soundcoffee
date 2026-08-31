"use client";

import { useEffect, useState } from "react";
import { SimplePool } from "nostr-tools/pool";
import { DEFAULT_RELAYS } from "@/lib/relays";

// Beyond our usual defaults — includes relays specific to other
// Gamma-compatible marketplace apps, since a shipping option published
// through one of them (e.g. Conduit) may live primarily on its own
// relay rather than the wider public ones.
const SHIPPING_SEARCH_RELAYS = [...DEFAULT_RELAYS, "wss://relay.conduit.market"];

let pool;
function getPool() {
  if (!pool) pool = new SimplePool();
  return pool;
}

function parseShippingOption(event) {
  const getTag = (name) => event.tags.find((t) => t[0] === name);
  const priceTag = getTag("price");
  return {
    title: getTag("title")?.[1] || "Shipping",
    price: priceTag
      ? { amount: priceTag[1], currency: priceTag[2] }
      : null,
    country: getTag("country")?.[1],
    service: getTag("service")?.[1],
  };
}

/**
 * Fetches a single Gamma Markets shipping option (kind 30406) by its
 * coordinate string, e.g. "30406:<pubkey>:<d-tag>". Plain async
 * function, not a hook — usable in a loop for resolving several items
 * at once, which a hook can't do.
 */
export async function fetchShippingOption(coordinate) {
  const [, pubkey, dTag] = coordinate.split(":");
  const event = await getPool().get(SHIPPING_SEARCH_RELAYS, {
    kinds: [30406],
    authors: [pubkey],
    "#d": [dTag],
  });
  return event ? parseShippingOption(event) : null;
}

/**
 * Fetches a single Gamma Markets shipping option (kind 30406) by its
 * coordinate string, e.g. "30406:<pubkey>:<d-tag>".
 */
export function useShippingOption(coordinate) {
  const [option, setOption] = useState(null);
  const [loading, setLoading] = useState(!!coordinate);

  useEffect(() => {
    if (!coordinate) {
      setOption(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);

    fetchShippingOption(coordinate)
      .then((option) => {
        if (!cancelled) setOption(option);
      })
      .catch(() => {
        if (!cancelled) setOption(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [coordinate]);

  return { option, loading };
}
