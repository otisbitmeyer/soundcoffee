"use client";

import { useCart } from "@/context/CartContext";

export default function CartButton({ className }) {
  const { itemCount, setDrawerOpen } = useCart();

  return (
    <button
      onClick={() => setDrawerOpen(true)}
      className={className || "relative font-display text-sm tracking-widest text-ink hover:text-rust"}
      aria-label="Open cart"
    >
      CART
      {itemCount > 0 && (
        <span className="absolute -right-3 -top-2 flex h-4 w-4 items-center justify-center rounded-full bg-rust text-[10px] text-paper">
          {itemCount}
        </span>
      )}
    </button>
  );
}
