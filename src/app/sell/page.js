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
    (text || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "x"
  );
}

let nextRowId = 1;
function newVariationRow() {
  return { id: nextRowId++, size: "", color: "", price: "", stock: "" };
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

  // Variations (e.g. t-shirt sizes/colors) — Gamma spec's variable/
  // variation product type. Off by default; a single simple listing
  // covers most products (like coffee bags).
  const [hasVariations, setHasVariations] = useState(false);
  const [variations, setVariations] = useState([newVariationRow(), newVariationRow()]);

  // Shipping (Gamma Markets extension to NIP-99, kind 30406). Optional —
  // only published if a shipping price is given. One option, shared
  // across all variations of a product.
  const [shipPrice, setShipPrice] = useState("");
  const [shipCurrency, setShipCurrency] = useState("USD");
  const [shipCountry, setShipCountry] = useState("US");
  const [shipService, setShipService] = useState("standard");

  const [status, setStatus] = useState("form"); // form | working | done | error
  const [error, setError] = useState("");
  const [publishedEventId, setPublishedEventId] = useState(null);

  const isRightAccount = pubkey === SOUND_COFFEE_PUBKEY;

  function updateVariation(id, field, value) {
    setVariations((rows) =>
      rows.map((r) => (r.id === id ? { ...r, [field]: value } : r))
    );
  }

  function addVariationRow() {
    setVariations((rows) => [...rows, newVariationRow()]);
  }

  function removeVariationRow(id) {
    setVariations((rows) => rows.filter((r) => r.id !== id));
  }

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
    if (!title.trim()) {
      setError("Title is required.");
      setStatus("error");
      return;
    }

    const validVariations = hasVariations
      ? variations.filter((v) => v.price && (v.size.trim() || v.color.trim()))
      : [];

    if (hasVariations && validVariations.length === 0) {
      setError("Add at least one variation with a size/color and a price.");
      setStatus("error");
      return;
    }
    if (!hasVariations && !priceAmount) {
      setError("Price is required.");
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
      const pool = new SimplePool();

      // Shipping option — published once, referenced by the parent and
      // (if applicable) every variation.
      let shippingTag = null;
      if (format === "physical" && shipPrice) {
        const shipDTag = `${dTag}-shipping`;
        const shipTemplate = {
          kind: 30406,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ["d", shipDTag],
            ["title", `${shipService} shipping`],
            ["price", shipPrice, shipCurrency],
            ["country", shipCountry],
            ["service", shipService],
          ],
          content: `${shipService} shipping`,
        };
        const signedShip = await signEvent(shipTemplate);
        await Promise.any(pool.publish(DEFAULT_RELAYS, signedShip));
        shippingTag = ["shipping_option", `30406:${pubkey}:${shipDTag}`];
      }

      const baseTags = [
        ["published_at", String(Math.floor(Date.now() / 1000))],
        ["status", "active"],
      ];
      if (summary.trim()) baseTags.push(["summary", summary.trim()]);
      for (const url of imageUrls) baseTags.push(["image", url]);
      if (shippingTag) baseTags.push(shippingTag);

      if (hasVariations) {
        // Parent "variable" listing — price shown is the lowest of its
        // variations, a common "starting at" convention, since the spec
        // still requires a price tag even on the parent.
        const lowest = Math.min(...validVariations.map((v) => Number(v.price)));
        const parentCoordinate = `30402:${pubkey}:${dTag}`;

        const parentTemplate = {
          kind: 30402,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ["d", dTag],
            ["title", title.trim()],
            ["price", String(lowest), priceCurrency],
            ["type", "variable", format],
            ...baseTags,
          ],
          content: description.trim(),
        };
        const signedParent = await signEvent(parentTemplate);
        await Promise.any(pool.publish(DEFAULT_RELAYS, signedParent));

        for (const v of validVariations) {
          const variantDTag = `${dTag}-${slugify(v.size)}-${slugify(v.color)}`;
          const label = [v.size.trim(), v.color.trim()].filter(Boolean).join(" / ");
          const tags = [
            ["d", variantDTag],
            ["title", `${title.trim()} — ${label}`],
            ["price", v.price, priceCurrency],
            ["type", "variation", format],
            ["a", parentCoordinate],
            ...baseTags,
          ];
          if (v.size.trim()) tags.push(["spec", "size", v.size.trim()]);
          if (v.color.trim()) tags.push(["spec", "color", v.color.trim()]);
          if (v.stock) tags.push(["stock", v.stock]);

          const variantTemplate = {
            kind: 30402,
            created_at: Math.floor(Date.now() / 1000),
            tags,
            content: description.trim(),
          };
          const signedVariant = await signEvent(variantTemplate);
          await Promise.any(pool.publish(DEFAULT_RELAYS, signedVariant));
        }

        setPublishedEventId(signedParent.id);
      } else {
        const template = {
          kind: 30402,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ["d", dTag],
            ["title", title.trim()],
            ["price", priceAmount, priceCurrency],
            ["type", "simple", format],
            ...baseTags,
          ],
          content: description.trim(),
        };
        const signed = await signEvent(template);
        await Promise.any(pool.publish(DEFAULT_RELAYS, signed));
        setPublishedEventId(signed.id);
      }

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
    setShipPrice("");
    setHasVariations(false);
    setVariations([newVariationRow(), newVariationRow()]);
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
                  placeholder="Ethiopia Yirgacheffe, 12oz  or  Sound Coffee T-Shirt"
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

              <label className="flex items-center gap-2 border-2 border-ink/20 p-3 text-ink">
                <input
                  type="checkbox"
                  checked={hasVariations}
                  onChange={(e) => setHasVariations(e.target.checked)}
                />
                This product comes in different sizes/colors (e.g. a t-shirt)
              </label>

              {!hasVariations && (
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
              )}

              {hasVariations && (
                <div className="border-2 border-ink/20 p-4">
                  <div className="flex items-center justify-between">
                    <label className="block font-display text-xs tracking-widest text-ink/60">
                      VARIATIONS
                    </label>
                    <select
                      value={priceCurrency}
                      onChange={(e) => setPriceCurrency(e.target.value)}
                      className="border-2 border-ink/30 px-2 py-1 font-display text-xs focus:border-ink focus:outline-none"
                    >
                      <option value="sats">sats</option>
                      <option value="USD">USD</option>
                    </select>
                  </div>
                  <p className="mt-1 mb-3 text-xs italic text-ink/50">
                    One row per size/color combo you actually sell. Leave
                    either field blank if it doesn&rsquo;t apply (e.g. only
                    sizes, no colors).
                  </p>

                  <div className="space-y-2">
                    {variations.map((v) => (
                      <div key={v.id} className="flex items-center gap-2">
                        <input
                          value={v.size}
                          onChange={(e) => updateVariation(v.id, "size", e.target.value)}
                          placeholder="Size (M)"
                          className="w-20 border-2 border-ink/30 px-2 py-1.5 text-sm focus:border-ink focus:outline-none"
                        />
                        <input
                          value={v.color}
                          onChange={(e) => updateVariation(v.id, "color", e.target.value)}
                          placeholder="Color (Black)"
                          className="w-24 border-2 border-ink/30 px-2 py-1.5 text-sm focus:border-ink focus:outline-none"
                        />
                        <input
                          type="number"
                          value={v.price}
                          onChange={(e) => updateVariation(v.id, "price", e.target.value)}
                          placeholder="Price"
                          className="w-20 border-2 border-ink/30 px-2 py-1.5 text-sm focus:border-ink focus:outline-none"
                        />
                        <input
                          type="number"
                          value={v.stock}
                          onChange={(e) => updateVariation(v.id, "stock", e.target.value)}
                          placeholder="Stock (optional)"
                          className="w-28 border-2 border-ink/30 px-2 py-1.5 text-sm focus:border-ink focus:outline-none"
                        />
                        <button
                          onClick={() => removeVariationRow(v.id)}
                          className="font-display text-rust hover:text-ink"
                          aria-label="Remove"
                        >
                          &times;
                        </button>
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={addVariationRow}
                    className="mt-3 font-display text-xs tracking-widest text-jade hover:text-ink"
                  >
                    + ADD ANOTHER VARIATION
                  </button>
                </div>
              )}

              <div>
                <label className="block font-display text-xs tracking-widest text-ink/60">
                  IMAGE URLS (one per line, shared across all variations)
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

              {format === "physical" && (
                <div className="border-2 border-ink/20 p-4">
                  <label className="block font-display text-xs tracking-widest text-ink/60">
                    SHIPPING (OPTIONAL)
                  </label>
                  <p className="mt-1 mb-3 text-xs italic text-ink/50">
                    Leave price blank to skip. Applies to all variations of
                    this product.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-display text-xs tracking-widest text-ink/50">
                        PRICE
                      </label>
                      <input
                        type="number"
                        value={shipPrice}
                        onChange={(e) => setShipPrice(e.target.value)}
                        className="mt-1 w-full border-2 border-ink/30 px-3 py-2 focus:border-ink focus:outline-none"
                        placeholder="5.99"
                      />
                    </div>
                    <div>
                      <label className="block font-display text-xs tracking-widest text-ink/50">
                        CURRENCY
                      </label>
                      <select
                        value={shipCurrency}
                        onChange={(e) => setShipCurrency(e.target.value)}
                        className="mt-1 w-full border-2 border-ink/30 px-3 py-2 focus:border-ink focus:outline-none"
                      >
                        <option value="USD">USD</option>
                        <option value="sats">sats</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-display text-xs tracking-widest text-ink/50">
                        COUNTRY
                      </label>
                      <input
                        value={shipCountry}
                        onChange={(e) => setShipCountry(e.target.value)}
                        className="mt-1 w-full border-2 border-ink/30 px-3 py-2 font-mono text-sm uppercase focus:border-ink focus:outline-none"
                        placeholder="US"
                        maxLength={2}
                      />
                    </div>
                    <div>
                      <label className="block font-display text-xs tracking-widest text-ink/50">
                        SERVICE
                      </label>
                      <select
                        value={shipService}
                        onChange={(e) => setShipService(e.target.value)}
                        className="mt-1 w-full border-2 border-ink/30 px-3 py-2 focus:border-ink focus:outline-none"
                      >
                        <option value="standard">Standard</option>
                        <option value="express">Express</option>
                        <option value="pickup">Local pickup</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

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
                {status === "working"
                  ? "PUBLISHING…"
                  : hasVariations
                  ? `PUBLISH LISTING + ${variations.filter((v) => v.price).length} VARIATIONS`
                  : "PUBLISH LISTING"}
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
