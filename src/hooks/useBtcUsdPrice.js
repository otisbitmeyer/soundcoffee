"use client";

import { useEffect, useState } from "react";

// PRICE ORACLE: River doesn't publish an open/keyless public price API —
// their Bitcoin API is a merchant Lightning integration that requires
// signing up for an account and an API key (which would also mean this
// needs to go through a backend, since API keys can't live in client-side
// code safely). Using CoinGecko's free, keyless endpoint as the working
// oracle for now. If/when there's a River API account + key, swap the
// fetch below for River's authenticated price endpoint — everything that
// calls this hook stays the same.
const PRICE_ENDPOINT =
  "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd";

let cachedPrice = null;
let cachedAt = 0;
const CACHE_MS = 60_000; // refresh at most once a minute

export function useBtcUsdPrice() {
  const [price, setPrice] = useState(cachedPrice);
  const [loading, setLoading] = useState(!cachedPrice);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (cachedPrice && Date.now() - cachedAt < CACHE_MS) {
      setPrice(cachedPrice);
      setLoading(false);
      return;
    }

    let cancelled = false;
    fetch(PRICE_ENDPOINT)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const usd = data?.bitcoin?.usd;
        if (!usd) throw new Error("No price in response");
        cachedPrice = usd;
        cachedAt = Date.now();
        setPrice(usd);
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
  }, []);

  return { btcUsdPrice: price, loading, error };
}

/** Converts a USD amount to whole sats at the given BTC/USD price. */
export function usdToSats(usdAmount, btcUsdPrice) {
  if (!btcUsdPrice) return null;
  return Math.round((Number(usdAmount) / btcUsdPrice) * 100_000_000);
}
