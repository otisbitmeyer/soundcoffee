"use client";

import { useNip99Listings } from "@/hooks/useNip99Listings";
import { SOUND_COFFEE_PUBKEY } from "@/lib/identities";
import ProductCard from "./ProductCard";

export default function ShopGrid() {
  const { listings, loading, error } = useNip99Listings(SOUND_COFFEE_PUBKEY);

  if (error) {
    return (
      <p className="mt-12 font-serif italic text-ink/50">
        Couldn&rsquo;t load products right now &mdash; check back soon.
      </p>
    );
  }

  if (loading) {
    return (
      <div className="mt-12 grid gap-8 sm:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="animate-pulse border-2 border-ink/20">
            <div className="aspect-square bg-ink/5" />
            <div className="p-5">
              <div className="h-4 w-3/4 bg-ink/10" />
              <div className="mt-3 h-3 w-1/2 bg-ink/10" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!listings || listings.length === 0) {
    return (
      <p className="mt-12 font-serif italic text-ink/50">
        No products listed yet &mdash; check back soon.
      </p>
    );
  }

  return (
    <div className="mt-12 grid gap-8 sm:grid-cols-3">
      {listings.map((listing) => (
        <ProductCard
          key={listing.id}
          listing={listing}
          sellerPubkey={SOUND_COFFEE_PUBKEY}
        />
      ))}
    </div>
  );
}
