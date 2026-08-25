"use client";

import { useEffect, useState } from "react";
import { SimplePool } from "nostr-tools/pool";
import { DEFAULT_RELAYS } from "@/lib/relays";

// One shared pool + in-memory cache for the whole site, so we don't open
// duplicate relay connections or re-fetch the same profile repeatedly.
let pool;
function getPool() {
  if (!pool) pool = new SimplePool();
  return pool;
}
const cache = new Map();

/**
 * Looks up a Nostr profile (kind 0 metadata, per NIP-01) for a given hex
 * pubkey. Returns { profile, loading }. profile is:
 *   - undefined  → no pubkey given yet
 *   - null       → looked it up, nobody has published metadata (or none
 *                  of our relays had it)
 *   - { name, display_name, picture, about, ... } → found it
 */
export function useProfile(pubkey) {
  const [profile, setProfile] = useState(() =>
    pubkey ? cache.get(pubkey) : undefined
  );
  const [loading, setLoading] = useState(!!pubkey && !cache.has(pubkey));

  useEffect(() => {
    if (!pubkey) {
      setProfile(undefined);
      setLoading(false);
      return;
    }
    if (cache.has(pubkey)) {
      setProfile(cache.get(pubkey));
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    getPool()
      .get(DEFAULT_RELAYS, { kinds: [0], authors: [pubkey] })
      .then((event) => {
        if (cancelled) return;
        if (!event) {
          cache.set(pubkey, null);
          setProfile(null);
          return;
        }
        try {
          const data = JSON.parse(event.content);
          cache.set(pubkey, data);
          setProfile(data);
        } catch {
          cache.set(pubkey, null);
          setProfile(null);
        }
      })
      .catch(() => {
        if (!cancelled) setProfile(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [pubkey]);

  return { profile, loading };
}
