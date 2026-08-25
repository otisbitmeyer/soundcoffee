"use client";

import { useState } from "react";
import CheckoutModal from "./CheckoutModal";

function formatPrice(price) {
  if (!price) return null;
  const { amount, currency, frequency } = price;
  const isSats = /^(sat|sats|btc)$/i.test(currency || "");
  const label = isSats
    ? `${Number(amount).toLocaleString()} sats`
    : `${amount} ${currency}`;
  return frequency ? `${label} / ${frequency}` : label;
}

export default function ProductCard({ listing, sellerPubkey }) {
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const priceLabel = formatPrice(listing.price);

  return (
    <div className="flex flex-col border-2 border-ink">
      <div className="flex aspect-square items-center justify-center overflow-hidden border-b-2 border-ink bg-ink/5">
        {listing.images[0] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={listing.images[0]}
            alt={listing.title}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="font-display text-xs tracking-widest text-ink/40">
            NO IMAGE
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col p-5">
        <h3 className="font-display text-lg text-ink">{listing.title}</h3>
        {listing.summary && (
          <p className="mt-1 font-serif text-sm text-ink/60">
            {listing.summary}
          </p>
        )}
        {priceLabel && (
          <span className="mt-3 block font-display text-rust">
            {priceLabel}
          </span>
        )}

        <div className="mt-4 pt-2">
          <button
            onClick={() => setCheckoutOpen(true)}
            className="w-full border-2 border-ink bg-ink px-4 py-2 font-display text-sm tracking-widest text-paper transition hover:bg-rust hover:border-rust"
          >
            ⚡ BUY WITH LIGHTNING
          </button>
        </div>
      </div>

      {checkoutOpen && (
        <CheckoutModal
          listing={listing}
          sellerPubkey={sellerPubkey}
          onClose={() => setCheckoutOpen(false)}
        />
      )}
    </div>
  );
}
