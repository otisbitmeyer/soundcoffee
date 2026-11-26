"use client";

import { useEffect, useState } from "react";
import { adminFetch } from "@/lib/adminFetch";
import { useNip99Listings } from "@/hooks/useNip99Listings";
import { SOUND_COFFEE_PUBKEY } from "@/lib/identities";

/**
 * Merchant Settings → Shop listings. Lists every product listing the
 * relays return for the shop account, with a button to hide or show each
 * one on the public shop. Hiding works by listing coordinate, so it holds
 * no matter how the publishing app tagged the listing.
 */
export default function ShopListingsAdmin() {
  const { listings, loading } = useNip99Listings(SOUND_COFFEE_PUBKEY);
  const [hidden, setHidden] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/hidden-listings")
      .then((r) => r.json())
      .then((d) => !cancelled && setHidden(new Set(d.hidden || [])))
      .catch(() => !cancelled && setError("Couldn't load the hide list."));
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle(listing) {
    const nowHidden = !hidden.has(listing.coordinate);
    setBusy(listing.coordinate);
    setError("");
    try {
      const res = await adminFetch("/api/hidden-listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coordinate: listing.coordinate, hidden: nowHidden }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't save.");
      setHidden(new Set(data.hidden));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-10 border-2 border-ink/20 p-5">
      <p className="font-display text-sm text-ink">SHOP LISTINGS</p>
      <p className="mt-1 font-serif text-xs text-ink/60">
        Everything published under the Sound Coffee account. Hide a listing to keep it off the
        public shop (event-only items, tests). Size and color options follow their parent product.
      </p>

      {error && (
        <p className="mt-3 border-2 border-rust bg-rust/10 px-3 py-2 font-serif text-xs text-rust">
          {error}
        </p>
      )}

      <div className="mt-3 space-y-1">
        {(loading || hidden === null) && !error && (
          <p className="font-serif text-xs italic text-ink/40">Loading…</p>
        )}
        {hidden &&
          listings?.map((l) => {
            const byTag = l.visibility === "hidden";
            const byList = hidden.has(l.coordinate);
            const isHidden = byTag || byList;
            return (
              <div
                key={l.id}
                className="flex items-center justify-between gap-3 border border-ink/10 px-2 py-1.5"
              >
                <div className="min-w-0">
                  <p className="truncate font-display text-xs text-ink">{l.title}</p>
                  <p className="truncate font-mono text-[10px] text-ink/40">
                    {l.productType}/{l.format} · {l.dTag}
                  </p>
                </div>
                {byTag && !byList ? (
                  <span className="shrink-0 font-display text-[10px] tracking-widest text-ink/40">
                    HIDDEN BY CONDUIT
                  </span>
                ) : (
                  <button
                    onClick={() => toggle(l)}
                    disabled={busy === l.coordinate}
                    className={`shrink-0 border-2 px-3 py-1 font-display text-[10px] tracking-widest disabled:opacity-50 ${
                      isHidden
                        ? "border-rust text-rust hover:bg-rust hover:text-paper"
                        : "border-ink text-ink hover:border-jade hover:text-jade"
                    }`}
                  >
                    {busy === l.coordinate ? "…" : isHidden ? "HIDDEN — SHOW" : "HIDE"}
                  </button>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}
