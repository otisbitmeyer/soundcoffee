"use client";

import { useEffect, useState } from "react";

export default function StripeReturnBanner() {
  const [message, setMessage] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("stripe_success")) {
      setMessage({
        text: "✓ Payment received — thanks! You'll get a confirmation shortly.",
        tone: "jade",
      });
    } else if (params.get("stripe_cancel")) {
      setMessage({ text: "Card payment cancelled — nothing was charged.", tone: "rust" });
    } else {
      return;
    }
    // Clean the URL so refreshing doesn't re-show the banner.
    params.delete("stripe_success");
    params.delete("stripe_cancel");
    params.delete("order");
    const clean = window.location.pathname + (params.toString() ? `?${params}` : "");
    window.history.replaceState({}, "", clean);
  }, []);

  if (!message) return null;

  return (
    <div
      className={`fixed left-1/2 top-4 z-[200] -translate-x-1/2 border-2 px-4 py-2 font-display text-sm tracking-wide shadow-lg ${
        message.tone === "jade"
          ? "border-jade bg-jade text-paper"
          : "border-rust bg-rust text-paper"
      }`}
    >
      {message.text}
      <button onClick={() => setMessage(null)} className="ml-3 opacity-70 hover:opacity-100">
        &times;
      </button>
    </div>
  );
}
