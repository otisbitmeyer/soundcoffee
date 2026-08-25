"use client";

import { useSearchParams } from "next/navigation";
import { useNip99Listings } from "@/hooks/useNip99Listings";
import { SELLERS } from "@/lib/sellers";
import ProductCard from "./ProductCard";

function SellerListings({ seller }) {
  const { listings, loading, error } = useNip99Listings(seller.pubkey);

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
    <div className="mt-12 grid gap-8 sm:grid-cols-3">
      {listings.map((listing) => (
        <ProductCard key={listing.id} listing={listing} sellerPubkey={seller.pubkey} />
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
