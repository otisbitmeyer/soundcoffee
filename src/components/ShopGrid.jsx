"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useNip99Listings } from "@/hooks/useNip99Listings";
import { SELLERS } from "@/lib/sellers";
import ProductCard from "./ProductCard";

function SellerListings({ seller }) {
  const { listings, allListings, loading, error } = useNip99Listings(seller.pubkey);
  const searchParams = useSearchParams();
  const sharedProduct = searchParams.get("product");

  // Only once the actual listing has loaded — scrolling to an element
  // that doesn't exist yet does nothing, so this waits for `listings`
  // to actually contain it.
  useEffect(() => {
    if (!sharedProduct || !listings?.some((l) => l.dTag === sharedProduct)) return;
    const el = document.getElementById(`product-${sharedProduct}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-4", "ring-jade");
    const timeout = setTimeout(() => el.classList.remove("ring-4", "ring-jade"), 2500);
    return () => clearTimeout(timeout);
  }, [sharedProduct, listings]);

  if (error) {
    return (
      <p className="mt-12 font-serif italic text-ink/50">
        Couldn&rsquo;t load products right now &mdash; check back soon.
      </p>
    );
  }

  if (loading) {
    return (
      <div
        className="mt-12 grid justify-center gap-8"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 300px))" }}
      >
        {[1, 2, 3].map((i) => (
          <div key={i} className="animate-pulse border-2 border-ink/20">
            <div className="aspect-square bg-ink/5" />
            <div className="p-5">
              <div className="mx-auto h-4 w-3/4 bg-ink/10" />
              <div className="mx-auto mt-3 h-3 w-1/2 bg-ink/10" />
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
    <div
      className="mt-12 grid justify-center gap-8"
      style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 300px))" }}
    >
      {listings.map((listing) => (
        <ProductCard
          key={listing.id}
          listing={listing}
          sellerPubkey={seller.pubkey}
          allListings={allListings}
        />
      ))}
    </div>
  );
}

export default function ShopGrid() {
  // ?seller=<id> scopes the shop to one seller's listings. Not meaningful
  // yet with only one seller, but this is the filter club members'
  // listings will plug into later — the "Buy Coffee" button already links
  // through this param.
  const searchParams = useSearchParams();
  const sellerFilter = searchParams.get("seller");

  const sellers = sellerFilter
    ? SELLERS.filter((s) => s.id === sellerFilter)
    : SELLERS;

  return (
    <>
      {sellers.map((seller) => (
        <SellerListings key={seller.id} seller={seller} />
      ))}
    </>
  );
}
