"use client";

import { useState } from "react";
import VariantPicker from "./VariantPicker";
import ImageGallery from "./ImageGallery";
import { getVariationsOf } from "@/hooks/useNip99Listings";
import { useBtcUsdPrice } from "@/hooks/useBtcUsdPrice";
import { formatDualPrice } from "@/lib/formatPrice";
import { useCart } from "@/context/CartContext";

const SUMMARY_LIMIT = 90;

function satsFromSatsOrBtc(price) {
  const currency = (price.currency || "").toLowerCase();
  if (currency === "sat" || currency === "sats") return Math.round(Number(price.amount));
  if (currency === "btc") return Math.round(Number(price.amount) * 100_000_000);
  return null;
}

function priceToSatsAndCents(price, btcUsdPrice) {
  if (!price) return { sats: null, usdCents: null };
  const isFiatUsd = (price.currency || "").toLowerCase() === "usd";
  const directSats = satsFromSatsOrBtc(price);
  const sats = directSats ?? (isFiatUsd && btcUsdPrice ? Math.round((Number(price.amount) / btcUsdPrice) * 100_000_000) : null);
  const usdCents = isFiatUsd
    ? Math.round(Number(price.amount) * 100)
    : directSats && btcUsdPrice
    ? Math.round((directSats / 100_000_000) * btcUsdPrice * 100)
    : null;
  return { sats, usdCents };
}

// For a variable product with several priced options — shows the
// actual price range across variations, not a placeholder like "see
// options". A single price (no dash) if every variation happens to
// cost the same.
function formatPriceRange(variations, btcUsdPrice) {
  const priced = variations
    .map((v) => priceToSatsAndCents(v.price, btcUsdPrice))
    .filter((p) => p.sats != null);
  if (priced.length === 0) return null;

  const satsValues = priced.map((p) => p.sats);
  const usdValues = priced.map((p) => p.usdCents).filter((c) => c != null);
  const minSats = Math.min(...satsValues);
  const maxSats = Math.max(...satsValues);

  if (minSats === maxSats) {
    const usdCents = usdValues.length > 0 ? usdValues[0] : null;
    return formatDualPrice({ sats: minSats, usdCents });
  }

  const satsPart = `${minSats.toLocaleString()}–${maxSats.toLocaleString()} sats`;
  if (usdValues.length === 0) return satsPart;
  const minUsd = Math.min(...usdValues);
  const maxUsd = Math.max(...usdValues);
  const usdPart =
    minUsd === maxUsd
      ? `$${(minUsd / 100).toFixed(2)}`
      : `$${(minUsd / 100).toFixed(2)}–$${(maxUsd / 100).toFixed(2)}`;
  return `${satsPart} · ${usdPart}`;
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
  const [pickerOpen, setPickerOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [justAdded, setJustAdded] = useState(false);
  const [justShared, setJustShared] = useState(false);
  const { btcUsdPrice } = useBtcUsdPrice();
  const { addItem } = useCart();

  function handleShare() {
    const url = `${window.location.origin}/?product=${encodeURIComponent(listing.dTag)}#shop`;
    navigator.clipboard.writeText(url).then(() => {
      setJustShared(true);
      setTimeout(() => setJustShared(false), 1500);
    });
  }

  const isVariable = listing.productType === "variable";
  const variations = isVariable ? getVariationsOf(allListings, listing.coordinate) : [];

  const priceLabel = isVariable
    ? formatPriceRange(variations, btcUsdPrice)
    : formatPrice(listing.price, btcUsdPrice);

  function handleAddToCart(item) {
    addItem({
      coordinate: item.coordinate,
      sellerPubkey,
      title: item.title,
      price: item.price,
      quantity: 1,
      image: item.images?.[0] || null,
      format: item.format,
      shippingCost: item.shippingCost || null,
      shippingOptionCoords: item.shippingOptionCoords || null,
    });
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 1500);
  }

  // Prefer the longer markdown content for the expanded view, falling
  // back to the summary if that's all there is.
  const fullText = listing.content?.trim() || listing.summary || "";
  const shortText = listing.summary || listing.content?.trim() || "";
  const needsTruncation = shortText.length > SUMMARY_LIMIT;
  const truncated = needsTruncation
    ? `${shortText.slice(0, SUMMARY_LIMIT).trim()}…`
    : shortText;

  return (
    <div id={`product-${listing.dTag}`} className="flex flex-col border-2 border-ink text-center">
      <ImageGallery
        images={listing.images}
        alt={listing.title}
        className="aspect-square border-b-2 border-ink"
      />
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-display text-lg text-ink">{listing.title}</h3>
          <button
            onClick={handleShare}
            title="Copy a shareable link"
            className="shrink-0 pt-1 text-ink/40 transition hover:text-jade"
          >
            {justShared ? (
              <span className="font-display text-[10px] tracking-widest text-jade">COPIED</span>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <line x1="8.6" y1="10.6" x2="15.4" y2="6.4" />
                <line x1="8.6" y1="13.4" x2="15.4" y2="17.6" />
              </svg>
            )}
          </button>
        </div>

        {shortText && (
          <div className="mt-1 font-serif text-sm text-ink/60">
            <p>{expanded ? fullText : truncated}</p>
            {(needsTruncation || fullText !== shortText) && (
              <button
                onClick={() => setExpanded((e) => !e)}
                className="mt-1 font-display text-xs tracking-widest text-rust hover:text-ink"
              >
                {expanded ? "SHOW LESS" : "LEARN MORE"}
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
            onClick={() => (isVariable ? setPickerOpen(true) : handleAddToCart(listing))}
            disabled={isVariable && variations.length === 0}
            className="w-full border-2 border-ink bg-ink px-4 py-2 font-display text-sm tracking-widest text-paper transition hover:bg-rust hover:border-rust disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isVariable
              ? variations.length === 0
                ? "COMING SOON"
                : "SELECT OPTIONS"
              : justAdded
              ? "✓ ADDED"
              : `ADD TO CART`}
          </button>
        </div>
      </div>

      {pickerOpen && (
        <VariantPicker
          parentListing={listing}
          variations={variations}
          onSelect={(variation) => {
            handleAddToCart(variation);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
