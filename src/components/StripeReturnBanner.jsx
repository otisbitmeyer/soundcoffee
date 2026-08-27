"use client";

import { useEffect, useState, useRef } from "react";
import { usePathname } from "next/navigation";

export default function StripeReturnBanner() {
  const [message, setMessage] = useState(null);
  const pathname = usePathname();
  const initialPathnameRef = useRef(pathname);

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

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 6000);
    return () => clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    if (pathname !== initialPathnameRef.current) {
      setMessage(null);
    }
  }, [pathname]);

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
