"use client";

import { useState, useMemo } from "react";
import ImageGallery from "./ImageGallery";
import { buyButtonLabel } from "@/lib/buyButtonLabel";

function formatPrice(price) {
  if (!price) return null;
  const { amount, currency, frequency } = price;
  const isSats = /^(sat|sats|btc)$/i.test(currency || "");
  const label = isSats
    ? `${Number(amount).toLocaleString()} sats`
    : `${amount} ${currency}`;
  return frequency ? `${label} / ${frequency}` : label;
}

export default function VariantPicker({ parentListing, variations, onSelect, onClose }) {
  // Collect every distinct attribute key across all variations (e.g.
  // "size", "color") and the values available for each, so we can render
  // one selector per attribute rather than assuming a fixed shape.
  const attributes = useMemo(() => {
    const map = new Map(); // key -> Set of values
    for (const v of variations) {
      for (const [key, value] of Object.entries(v.specs)) {
        if (!map.has(key)) map.set(key, new Set());
        map.get(key).add(value);
      }
    }
    return [...map.entries()].map(([key, values]) => ({ key, values: [...values] }));
  }, [variations]);

  const [selected, setSelected] = useState({});

  const allChosen = attributes.every((a) => selected[a.key]);
  const matchedVariation = allChosen
    ? variations.find((v) =>
        attributes.every((a) => v.specs[a.key] === selected[a.key])
      )
    : null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/80 px-4">
      <div className="w-full max-w-md border-2 border-ink bg-paper">
        <div className="flex items-center justify-between border-b-2 border-ink px-6 py-4">
          <h2 className="font-display text-xl tracking-wide text-ink">
            {parentListing.title}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="font-display text-2xl leading-none text-ink hover:text-rust"
          >
            &times;
          </button>
        </div>

        <div className="space-y-5 px-6 py-6 font-serif text-sm text-ink/80">
          {attributes.map((attr) => (
            <div key={attr.key}>
              <label className="block font-display text-xs uppercase tracking-widest text-ink/60">
                {attr.key}
              </label>
              <div className="mt-2 flex flex-wrap gap-2">
                {attr.values.map((value) => {
                  const isSelected = selected[attr.key] === value;
                  // Disable options that don't exist in combination with
                  // what's already picked, so the buyer can't select an
                  // impossible combo.
                  const wouldMatch = variations.some((v) => {
                    if (v.specs[attr.key] !== value) return false;
                    return attributes
                      .filter((a) => a.key !== attr.key && selected[a.key])
                      .every((a) => v.specs[a.key] === selected[a.key]);
                  });

                  return (
                    <button
                      key={value}
                      disabled={!wouldMatch}
                      onClick={() =>
                        setSelected((s) => ({ ...s, [attr.key]: value }))
                      }
                      className={`border-2 px-3 py-1.5 font-display text-sm ${
                        isSelected
                          ? "border-ink bg-ink text-paper"
                          : wouldMatch
                          ? "border-ink/30 text-ink hover:border-ink"
                          : "cursor-not-allowed border-ink/10 text-ink/30 line-through"
                      }`}
                    >
                      {value}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {matchedVariation && (
            <div className="border-t-2 border-ink/10 pt-4">
              {matchedVariation.images.length > 0 && (
                <ImageGallery
                  images={matchedVariation.images}
                  alt={matchedVariation.title}
                  className="mb-3 h-40 w-full border-2 border-ink/20"
                />
              )}
              <p className="font-display text-lg text-rust">
                {formatPrice(matchedVariation.price)}
              </p>
              {matchedVariation.status === "sold" && (
                <p className="mt-1 font-serif text-xs text-rust">
                  This combination is sold out.
                </p>
              )}
            </div>
          )}

          <button
            onClick={() => onSelect(matchedVariation)}
            disabled={!matchedVariation || matchedVariation.status === "sold"}
            className="w-full border-2 border-ink bg-ink px-4 py-3 font-display text-sm tracking-widest text-paper transition hover:bg-rust hover:border-rust disabled:cursor-not-allowed disabled:opacity-40"
          >
            {matchedVariation ? buyButtonLabel(parentListing.title) : "SELECT OPTIONS"}
          </button>
        </div>
      </div>
    </div>
  );
}
