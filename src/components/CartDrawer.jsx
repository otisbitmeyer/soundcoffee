"use client";

import { useState } from "react";
import { useCart } from "@/context/CartContext";
import { useBtcUsdPrice } from "@/hooks/useBtcUsdPrice";
import { formatDualPrice } from "@/lib/formatPrice";
import CheckoutModal from "./CheckoutModal";

function satsFromSatsOrBtc(price) {
  const currency = (price.currency || "").toLowerCase();
  if (currency === "sat" || currency === "sats") return Math.round(Number(price.amount));
  if (currency === "btc") return Math.round(Number(price.amount) * 100_000_000);
  return null;
}

function lineTotalDisplay(item, btcUsdPrice) {
  const isFiatUsd = (item.price.currency || "").toLowerCase() === "usd";
  const unitSats = isFiatUsd
    ? btcUsdPrice
      ? Math.round((Number(item.price.amount) / btcUsdPrice) * 100_000_000)
      : null
    : satsFromSatsOrBtc(item.price);
  const unitUsdCents = isFiatUsd
    ? Math.round(Number(item.price.amount) * 100)
    : unitSats && btcUsdPrice
    ? Math.round((unitSats / 100_000_000) * btcUsdPrice * 100)
    : null;

  const sats = unitSats ? unitSats * item.quantity : null;
  const usdCents = unitUsdCents ? unitUsdCents * item.quantity : null;
  return formatDualPrice({ sats, usdCents }) || `${item.price.amount} ${item.price.currency}`;
}

export default function CartDrawer() {
  const { items, removeItem, updateQuantity, drawerOpen, setDrawerOpen } = useCart();
  const { btcUsdPrice } = useBtcUsdPrice();
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  if (!drawerOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-[110] flex justify-end bg-ink/60">
        <div className="flex h-full w-full max-w-sm flex-col border-l-2 border-ink bg-paper">
          <div className="flex items-center justify-between border-b-2 border-ink px-5 py-4">
            <h2 className="font-display text-lg tracking-wide text-ink">YOUR CART</h2>
            <button
              onClick={() => setDrawerOpen(false)}
              aria-label="Close cart"
              className="font-display text-2xl leading-none text-ink hover:text-rust"
            >
              &times;
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {items.length === 0 ? (
              <p className="mt-6 text-center font-serif text-sm text-ink/50">
                Your cart is empty.
              </p>
            ) : (
              <div className="space-y-4">
                {items.map((item) => (
                  <div key={item.coordinate} className="flex gap-3 border-b border-ink/10 pb-4">
                    {item.image && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.image}
                        alt=""
                        className="h-16 w-16 shrink-0 border border-ink/20 object-cover"
                      />
                    )}
                    <div className="flex-1">
                      <p className="font-display text-sm text-ink">{item.title}</p>
                      <p className="mt-0.5 font-serif text-xs text-ink/50">
                        {lineTotalDisplay(item, btcUsdPrice)}
                      </p>
                      <div className="mt-1.5 flex items-center gap-2">
                        <button
                          onClick={() => updateQuantity(item.coordinate, item.quantity - 1)}
                          className="border border-ink/30 px-2 font-display text-xs text-ink hover:border-ink"
                        >
                          −
                        </button>
                        <span className="font-serif text-sm text-ink">{item.quantity}</span>
                        <button
                          onClick={() => updateQuantity(item.coordinate, item.quantity + 1)}
                          className="border border-ink/30 px-2 font-display text-xs text-ink hover:border-ink"
                        >
                          +
                        </button>
                        <button
                          onClick={() => removeItem(item.coordinate)}
                          className="ml-auto font-display text-[10px] tracking-widest text-rust hover:text-ink"
                        >
                          REMOVE
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {items.length > 0 && (
            <div className="border-t-2 border-ink px-5 py-4">
              <button
                onClick={() => setCheckoutOpen(true)}
                className="w-full border-2 border-ink bg-ink px-4 py-3 font-display text-sm tracking-widest text-paper hover:bg-rust hover:border-rust"
              >
                CHECKOUT
              </button>
            </div>
          )}
        </div>
      </div>

      {checkoutOpen && (
        <CheckoutModal
          onClose={() => {
            setCheckoutOpen(false);
            setDrawerOpen(false);
          }}
        />
      )}
    </>
  );
}
