"use client";

import { useRouter } from "next/navigation";

export default function BuyCoffeeButton() {
  const router = useRouter();

  function handleClick(e) {
    e.preventDefault();
    // Always scroll, regardless of whether the URL already has this hash —
    // a plain <Link> silently no-ops on the second click if the URL
    // wouldn't change, which is the bug this works around.
    document.getElementById("shop")?.scrollIntoView({ behavior: "smooth" });
    router.replace("/?seller=sound-coffee#shop", { scroll: false });
  }

  return (
    <button
      onClick={handleClick}
      className="inline-block border-2 border-ink bg-ink px-5 py-2.5 font-display text-sm tracking-widest text-paper transition hover:bg-rust hover:border-rust"
    >
      BUY COFFEE
    </button>
  );
}
