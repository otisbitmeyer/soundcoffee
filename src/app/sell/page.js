"use client";

import { useState } from "react";
import { SimplePool } from "nostr-tools/pool";
import Header from "@/components/Header";
import LoginModal from "@/components/LoginModal";
import { useAuth } from "@/context/AuthContext";
import { DEFAULT_RELAYS } from "@/lib/relays";
import { SOUND_COFFEE_PUBKEY } from "@/lib/identities";

function slugify(text) {
  return (
    text
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "listing"
  );
}

export default function SellPage() {
  const { isLoggedIn, pubkey, signEvent } = useAuth();
  const [showLogin, setShowLogin] = useState(false);

  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [priceAmount, setPriceAmount] = useState("");
  const [priceCurrency, setPriceCurrency] = useState("sats");
  const [images, setImages] = useState("");
  const [format, setFormat] = useState("physical");

  const [status, setStatus] = useState("form"); // form | working | done | error
  const [error, setError] = useState("");
  const [publishedEventId, setPublishedEventId] = useState(null);

  const isRightAccount = pubkey === SOUND_COFFEE_PUBKEY;

  async function handlePublish() {
    if (!isLoggedIn) {
      setShowLogin(true);
      return;
    }
    if (!isRightAccount) {
      setError(
        "You're logged in, but not as the Sound Coffee account — listings need to be published from that identity so they show up in the Shop."
      );
      setStatus("error");
      return;
    }
    if (!title.trim() || !priceAmount) {
      setError("Title and price are required.");
      setStatus("error");
      return;
    }

    setStatus("working");
    setError("");

    try {
      const dTag = `${slugify(title)}-${Date.now()}`;
      const imageUrls = images
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);

      const tags = [
        ["d", dTag],
        ["title", title.trim()],
        ["published_at", String(Math.floor(Date.now() / 1000))],
        ["price", priceAmount, priceCurrency],
        ["status", "active"],
        ["type", "simple", format],
      ];
      if (summary.trim()) tags.push(["summary", summary.trim()]);
      for (const url of imageUrls) tags.push(["image", url]);

      const template = {
        kind: 30402,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: description.trim(),
      };

      const signed = await signEvent(template);

      const pool = new SimplePool();
      await Promise.any(pool.publish(DEFAULT_RELAYS, signed));

      setPublishedEventId(signed.id);
      setStatus("done");
    } catch (e) {
      setError(e.message || "Something went wrong publishing this listing.");
      setStatus("error");
    }
  }

  function handlePublishAnother() {
    setTitle("");
    setSummary("");
    setDescription("");
    setPriceAmount("");
    setImages("");
    setStatus("form");
    setPublishedEventId(null);
  }

  return (
    <>
      <Header />

      <main className="flex-1 bg-paper">
        <div className="mx-auto max-w-xl px-6 py-16">
          <h1 className="text-center font-display text-4xl tracking-wide text-ink">
            NEW LISTING
          </h1>
          <p className="mt-3 text-center font-serif text-ink/70">
            Publishes a NIP-99 product listing directly to Nostr. It'll
            show up in the Shop as soon as relays pick it up &mdash;
            usually within a few seconds.
          </p>

          {!isLoggedIn && (
            <div className="mt-10 border-2 border-ink p-6 text-center">
              <p className="font-serif text-ink/80">
                Log in as the Sound Coffee account to publish a listing.
              </p>
              <button
                onClick={() => setShowLogin(true)}
                className="mt-4 border-2 border-ink bg-ink px-5 py-2.5 font-display text-sm tracking-widest text-paper hover:bg-rust hover:border-rust"
              >
                LOG IN
              </button>
            </div>
          )}

          {isLoggedIn && !isRightAccount && (
            <p className="mt-10 border-2 border-rust bg-rust/10 p-4 text-center font-serif text-rust">
              You&rsquo;re logged in, but not as the Sound Coffee account.
              Log out and back in with that identity to publish here.
            </p>
          )}

          {isLoggedIn && isRightAccount && status !== "done" && (
            <div className="mt-10 space-y-5 font-serif text-sm text-ink/80">
              <div>
                <label className="block font-display text-xs tracking-widest text-ink/60">
                  TITLE
                </label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="mt-1 w-full border-2 border-ink/30 px-3 py-2 focus:border-ink focus:outline-none"
                  placeholder="Ethiopia Yirgacheffe, 12oz"
                />
              </div>

              <div>
                <label className="block font-display text-xs tracking-widest text-ink/60">
                  SHORT SUMMARY (shows on the product card)
                </label>
                <input
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  className="mt-1 w-full border-2 border-ink/30 px-3 py-2 focus:border-ink focus:outline-none"
                  placeholder="Bright, floral, a little funky."
                />
              </div>

              <div>
                <label className="block font-display text-xs tracking-widest text-ink/60">
                  FULL DESCRIPTION (shown when "read more" is clicked)
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  className="mt-1 w-full resize-none border-2 border-ink/30 px-3 py-2 focus:border-ink focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block font-display text-xs tracking-widest text-ink/60">
                    PRICE
                  </label>
                  <input
                    type="number"
                    value={priceAmount}
                    onChange={(e) => setPriceAmount(e.target.value)}
                    className="mt-1 w-full border-2 border-ink/30 px-3 py-2 focus:border-ink focus:outline-none"
                    placeholder="18"
                  />
                </div>
                <div>
                  <label className="block font-display text-xs tracking-widest text-ink/60">
                    CURRENCY
                  </label>
                  <select
                    value={priceCurrency}
                    onChange={(e) => setPriceCurrency(e.target.value)}
                    className="mt-1 w-full border-2 border-ink/30 px-3 py-2 focus:border-ink focus:outline-none"
                  >
                    <option value="sats">sats</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-display text-xs tracking-widest text-ink/60">
                  IMAGE URLS (one per line)
                </label>
                <textarea
                  value={images}
                  onChange={(e) => setImages(e.target.value)}
                  rows={2}
                  className="mt-1 w-full resize-none border-2 border-ink/30 px-3 py-2 font-mono text-xs focus:border-ink focus:outline-none"
                  placeholder="https://..."
                />
                <p className="mt-1 text-xs italic text-ink/50">
                  Needs to be a URL to an already-hosted image. This form
                  doesn&rsquo;t upload files itself yet.
                </p>
              </div>

              <div>
                <label className="block font-display text-xs tracking-widest text-ink/60">
                  TYPE
                </label>
                <select
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                  className="mt-1 w-full border-2 border-ink/30 px-3 py-2 focus:border-ink focus:outline-none"
                >
                  <option value="physical">Physical (ships to buyer)</option>
                  <option value="digital">Digital</option>
                </select>
              </div>

              {error && (
                <p className="border-2 border-rust bg-rust/10 px-3 py-2 text-rust">
                  {error}
                </p>
              )}

              <button
                onClick={handlePublish}
                disabled={status === "working"}
                className="w-full border-2 border-ink bg-ink px-4 py-3 font-display text-sm tracking-widest text-paper transition hover:bg-rust hover:border-rust disabled:opacity-50"
              >
                {status === "working" ? "PUBLISHING…" : "PUBLISH LISTING"}
              </button>
            </div>
          )}

          {status === "done" && (
            <div className="mt-10 space-y-4 text-center font-serif text-ink/80">
              <p className="text-2xl">✓</p>
              <p>Listing published. It should show up in the Shop shortly.</p>
              <p className="text-xs italic text-ink/50">
                Event ID: {publishedEventId}
              </p>
              <button
                onClick={handlePublishAnother}
                className="border-2 border-ink px-5 py-2.5 font-display text-sm tracking-widest text-ink hover:border-jade hover:text-jade"
              >
                PUBLISH ANOTHER
              </button>
            </div>
          )}
        </div>
      </main>

      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
    </>
  );
}
