"use client";

import { useState } from "react";
import CheckoutModal from "./CheckoutModal";
import VariantPicker from "./VariantPicker";
import ImageGallery from "./ImageGallery";
import { getVariationsOf } from "@/hooks/useNip99Listings";
import { buyButtonLabel } from "@/lib/buyButtonLabel";
import { useBtcUsdPrice } from "@/hooks/useBtcUsdPrice";
import { formatDualPrice } from "@/lib/formatPrice";

const SUMMARY_LIMIT = 90;

function satsFromSatsOrBtc(price) {
  const currency = (price.currency || "").toLowerCase();
  if (currency === "sat" || currency === "sats") return Math.round(Number(price.amount));
  if (currency === "btc") return Math.round(Number(price.amount) * 100_000_000);
  return null;
}

function formatPrice(price, btcUsdPrice) {
  if (!price) return null;
  const isFiatUsd = (price.currency || "").toLowerCase() === "usd";
  const directSats = satsFromSatsOrBtc(price);

  const sats = directSats ?? (isFiatUsd && btcUsdPrice ? Math.round((Number(price.amount) / btcUsdPrice) * 100_000_000) : null);
  const usdCents = isFiatUsd
    ? Math.round(Number(price.amount) * 100)
    : directSats && btcUsdPrice
    ? Math.round((directSats / 100_000_000) * btcUsdPrice * 100)
    : null;

  const dual = formatDualPrice({ sats, usdCents });
  if (dual) return price.frequency ? `${dual} / ${price.frequency}` : dual;

  // Fallback if we can't derive both (e.g. price feed hasn't loaded yet)
  // — still show whatever currency the listing is actually priced in.
  const label = `${price.amount} ${price.currency}`;
  return price.frequency ? `${label} / ${price.frequency}` : label;
}

export default function ProductCard({ listing, sellerPubkey, allListings }) {
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [chosenVariation, setChosenVariation] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const { btcUsdPrice } = useBtcUsdPrice();

  const isVariable = listing.productType === "variable";
  const variations = isVariable ? getVariationsOf(allListings, listing.coordinate) : [];

  const priceLabel = isVariable
    ? variations.length > 0
      ? "SEE OPTIONS"
      : null
    : formatPrice(listing.price, btcUsdPrice);

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
