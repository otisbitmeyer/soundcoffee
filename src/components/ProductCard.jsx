"use client";

import { useState } from "react";
import CheckoutModal from "./CheckoutModal";
import VariantPicker from "./VariantPicker";
import ImageGallery from "./ImageGallery";
import { getVariationsOf } from "@/hooks/useNip99Listings";
import { buyButtonLabel } from "@/lib/buyButtonLabel";

const SUMMARY_LIMIT = 90;

function formatPrice(price) {
  if (!price) return null;
  const { amount, currency, frequency } = price;
  const isSats = /^(sat|sats|btc)$/i.test(currency || "");
  const label = isSats
    ? `${Number(amount).toLocaleString()} sats`
    : `${amount} ${currency}`;
  return frequency ? `${label} / ${frequency}` : label;
}

export default function ProductCard({ listing, sellerPubkey, allListings }) {
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [chosenVariation, setChosenVariation] = useState(null);
  const [expanded, setExpanded] = useState(false);

  const isVariable = listing.productType === "variable";
  const variations = isVariable ? getVariationsOf(allListings, listing.coordinate) : [];

  const priceLabel = isVariable
    ? variations.length > 0
      ? "SEE OPTIONS"
      : null
    : formatPrice(listing.price);

  // Prefer the longer markdown content for the expanded view, falling
  // back to the summary if that's all there is.
  const fullText = listing.content?.trim() || listing.summary || "";
  const shortText = listing.summary || listing.content?.trim() || "";
  const needsTruncation = shortText.length > SUMMARY_LIMIT;
  const truncated = needsTruncation
    ? `${shortText.slice(0, SUMMARY_LIMIT).trim()}…`
    : shortText;

  return (
    <div className="flex flex-col border-2 border-ink text-center">
      <ImageGallery
        images={listing.images}
        alt={listing.title}
        className="aspect-square border-b-2 border-ink"
      />
      <div className="flex flex-1 flex-col p-5">
        <h3 className="font-display text-lg text-ink">{listing.title}</h3>

        {shortText && (
          <div className="mt-1 font-serif text-sm text-ink/60">
            <p>{expanded ? fullText : truncated}</p>
            {(needsTruncation || (expanded && fullText !== shortText)) && (
              <button
                onClick={() => setExpanded((e) => !e)}
                className="mt-1 font-display text-xs tracking-widest text-rust hover:text-ink"
              >
                {expanded ? "SHOW LESS" : "READ MORE"}
              </button>
            )}
          </div>
        )}

        {priceLabel && (
          <span className="mt-3 block font-display text-rust">
            {priceLabel}
          </span>
        )}

        <div className="mt-4 pt-2">
          <button
            onClick={() => (isVariable ? setPickerOpen(true) : setCheckoutOpen(true))}
            disabled={isVariable && variations.length === 0}
            className="w-full border-2 border-ink bg-ink px-4 py-2 font-display text-sm tracking-widest text-paper transition hover:bg-rust hover:border-rust disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isVariable
              ? variations.length === 0
                ? "COMING SOON"
                : "SELECT OPTIONS"
              : buyButtonLabel(listing.title)}
          </button>
        </div>
      </div>

      {pickerOpen && (
        <VariantPicker
          parentListing={listing}
          variations={variations}
          onSelect={(variation) => {
            setChosenVariation(variation);
            setPickerOpen(false);
            setCheckoutOpen(true);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {checkoutOpen && (
        <CheckoutModal
          listing={chosenVariation || listing}
          sellerPubkey={sellerPubkey}
          onClose={() => {
            setCheckoutOpen(false);
            setChosenVariation(null);
          }}
        />
      )}
    </div>
  );
}
