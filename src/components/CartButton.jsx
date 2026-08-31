"use client";

import { useCart } from "@/context/CartContext";

export default function CartButton({ className }) {
  const { itemCount, setDrawerOpen } = useCart();

  if (itemCount === 0) return null;

  return (
    <button
      onClick={() => setDrawerOpen(true)}
      className={className || "relative text-ink hover:text-rust"}
      aria-label="Open cart"
    >
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="9" cy="21" r="1.5" fill="currentColor" stroke="none" />
        <circle cx="19" cy="21" r="1.5" fill="currentColor" stroke="none" />
        <path d="M2.5 3h2l2.7 12.6a2 2 0 0 0 2 1.6h8.6a2 2 0 0 0 2-1.6L21.5 8H6" />
      </svg>
      <span className="absolute -right-2 -top-2 flex h-4 w-4 items-center justify-center rounded-full bg-rust text-[10px] text-paper">
        {itemCount}
      </span>
    </button>
  );
}
