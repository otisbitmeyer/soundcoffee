"use client";

import { useEffect, useState } from "react";
import { SimplePool } from "nostr-tools/pool";
import { DEFAULT_RELAYS } from "@/lib/relays";

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
    const [, pubkey, dTag] = coordinate.split(":");
    let cancelled = false;
    setLoading(true);

    getPool()
      .get(DEFAULT_RELAYS, { kinds: [30406], authors: [pubkey], "#d": [dTag] })
      .then((event) => {
        if (cancelled) return;
        setOption(event ? parseShippingOption(event) : null);
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
