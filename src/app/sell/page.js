"use client";

import { useState, useEffect } from "react";
import { SimplePool } from "nostr-tools/pool";
import { nip19 } from "nostr-tools";
import Header from "@/components/Header";
import LoginModal from "@/components/LoginModal";
import { useAuth } from "@/context/AuthContext";
import { useNip99Listings, getVariationsOf } from "@/hooks/useNip99Listings";
import { fetchShippingOption } from "@/hooks/useShippingOption";
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
  return { id: nextRowId++, size: "", color: "", price: "", stock: "", images: "" };
}

function ListingRow({ listing, pubkey, signEvent, onDeleted, onEdit }) {
  const [deleting, setDeleting] = useState(false);
  const [stock, setStock] = useState("");
  const [stockLoaded, setStockLoaded] = useState(false);
  const [savingStock, setSavingStock] = useState(false);
  const [stockSaved, setStockSaved] = useState(false);

  useEffect(() => {
    fetch(`/api/inventory?coordinate=${encodeURIComponent(listing.coordinate)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.available !== null && data.available !== undefined) {
          setStock(String(data.available));
        }
      })
      .catch(() => {})
      .finally(() => setStockLoaded(true));
  }, [listing.coordinate]);

  async function handleSaveStock() {
    setSavingStock(true);
    setStockSaved(false);
    try {
      await fetch("/api/inventory/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productCoordinate: listing.coordinate,
          title: listing.title,
          stock: stock === "" ? null : Number(stock),
        }),
      });
      setStockSaved(true);
      setTimeout(() => setStockSaved(false), 2000);
    } catch {
      alert("Couldn't save that stock number. Try again.");
    } finally {
      setSavingStock(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete "${listing.title}"? This can't be undone.`)) return;
    setDeleting(true);
    try {
      // NIP-09 deletion request — includes both the addressable
      // coordinate (correct for a parameterized-replaceable NIP-99
      // listing) and the specific event id, for broader client support.
      const template = {
        kind: 5,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["a", listing.coordinate],
          ["e", listing.id],
          ["k", "30402"],
        ],
        content: "Listing removed by seller.",
      };
      const signed = await signEvent(template);
      const pool = new SimplePool();
      await Promise.any(pool.publish(DEFAULT_RELAYS, signed));
      onDeleted(listing.coordinate);
    } catch {
      alert("Something went wrong deleting this listing. Try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {listing.images?.[0] && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={listing.images[0]}
              alt=""
              className="h-12 w-12 shrink-0 border border-ink/20 object-cover"
            />
          )}
          <div>
            <p className="font-display text-sm text-ink">{listing.title}</p>
            <p className="font-serif text-xs text-ink/50">
              {listing.price ? `${listing.price.amount} ${listing.price.currency}` : "No price"}
              {listing.productType !== "simple" ? ` · ${listing.productType}` : ""}
            </p>
            <a
              href={`https://njump.me/${nip19.naddrEncode({
                kind: 30402,
                pubkey: listing.pubkey,
                identifier: listing.dTag,
              })}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[11px] text-jade hover:underline"
            >
              view raw event ↗
            </a>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {listing.productType !== "variation" && (
            <button
              onClick={() => onEdit(listing)}
              className="border-2 border-ink px-3 py-1.5 font-display text-xs tracking-widest text-ink hover:border-jade hover:text-jade"
            >
              EDIT
            </button>
          )}
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="border-2 border-rust px-3 py-1.5 font-display text-xs tracking-widest text-rust hover:bg-rust hover:text-paper disabled:opacity-50"
          >
            {deleting ? "DELETING…" : "DELETE"}
          </button>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2 pl-[60px]">
        <label className="font-display text-xs tracking-widest text-ink/50">
          STOCK
        </label>
        <input
          type="number"
          value={stock}
          onChange={(e) => setStock(e.target.value)}
          placeholder={stockLoaded ? "unlimited" : "…"}
          className="w-24 border-2 border-ink/30 px-2 py-1 font-serif text-xs focus:border-ink focus:outline-none"
        />
        <button
          onClick={handleSaveStock}
          disabled={savingStock}
          className="border-2 border-ink/30 px-2 py-1 font-display text-[11px] tracking-widest text-ink hover:border-ink disabled:opacity-50"
        >
          {savingStock ? "SAVING…" : stockSaved ? "✓ SAVED" : "SAVE"}
        </button>
        <span className="font-serif text-[11px] italic text-ink/40">
          leave blank for unlimited
        </span>
      </div>
    </div>
  );
}

/**
 * A single top-level listing (simple, or a variable parent) rendered
 * via ListingRow — with its variations, if any, nested in a collapsed
 * dropdown underneath instead of showing as separate flat rows.
 */
function ListingWithVariations({ listing, allListings, pubkey, signEvent, onDeleted, onEdit }) {
  const variations =
    listing.productType === "variable" ? getVariationsOf(allListings, listing.coordinate) : [];

  return (
    <div className="border-b border-ink/10 py-3 last:border-b-0">
      <ListingRow
        listing={listing}
        pubkey={pubkey}
        signEvent={signEvent}
        onDeleted={onDeleted}
        onEdit={onEdit}
      />

      {variations.length > 0 && (
        <details className="group ml-[60px] mt-2">
          <summary className="list-none cursor-pointer select-none font-display text-[11px] tracking-widest text-ink/40 marker:content-none hover:text-ink [&::-webkit-details-marker]:hidden">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block text-[9px] transition-transform duration-200 group-open:rotate-90">
                ▸
              </span>
              {variations.length} VARIATION{variations.length === 1 ? "" : "S"}
            </span>
          </summary>
          <div className="mt-2 border-l-2 border-ink/10 pl-4">
            {variations.map((v) => (
              <ListingRow
                key={v.id}
                listing={v}
                pubkey={pubkey}
                signEvent={signEvent}
                onDeleted={onDeleted}
                onEdit={onEdit}
              />
            ))}
          </div>
        </details>
      )}
    </div>
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
  const [imageUrls, setImageUrls] = useState("");
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

  // Set while editing an existing listing — republishing reuses this
  // exact d-tag instead of generating a new one, which is what makes it
  // an edit (replaces the old version) rather than a duplicate listing.
  // Editing is supported for simple listings and variable parents, not
  // yet for individual variations.
  const [editingDTag, setEditingDTag] = useState(null);

  const [status, setStatus] = useState("form"); // form | working | done | error
  const [error, setError] = useState("");
  const [publishedEventId, setPublishedEventId] = useState(null);

  const isRightAccount = pubkey === SOUND_COFFEE_PUBKEY;
  const { listings, allListings } = useNip99Listings(isRightAccount ? SOUND_COFFEE_PUBKEY : null);
  const [deletedCoords, setDeletedCoords] = useState(new Set());

  function handleDeleted(coordinate) {
    setDeletedCoords((prev) => new Set(prev).add(coordinate));
  }

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

    // Editing a variable parent's own fields doesn't touch its
    // variations at all — they stay exactly as they are, separate
    // events. Only require filled-in variation rows when actually
    // creating them, i.e. not while editing.
    if (!editingDTag && hasVariations && validVariations.length === 0) {
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

    // When editing, preserve the listing's actual original type
    // (variable vs simple) — the hasVariations checkbox reflects it
    // directly here, pre-filled correctly by handleEdit but always
    // editable, so if a listing's type is ever wrong (e.g. corrupted by
    // an old version of this same bug) there's a real way to fix it
    // rather than being stuck with silently "preserving" a bad state.
    const publishAsVariable = hasVariations;

    try {
      const dTag = editingDTag || `${slugify(title)}-${Date.now()}`;
      const defaultImageUrls = imageUrls
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
      if (shippingTag) baseTags.push(shippingTag);

      if (hasVariations) {
        // Parent "variable" listing — price shown is the lowest of its
        // variations, a common "starting at" convention, since the spec
        // still requires a price tag even on the parent.
        const lowest = Math.min(...validVariations.map((v) => Number(v.price)));
        const parentCoordinate = `30402:${pubkey}:${dTag}`;

        const parentTags = [
          ["d", dTag],
          ["title", title.trim()],
          ["price", String(lowest), priceCurrency],
          ["type", "variable", format],
          ...baseTags,
        ];
        for (const url of defaultImageUrls) parentTags.push(["image", url]);

        const parentTemplate = {
          kind: 30402,
          created_at: Math.floor(Date.now() / 1000),
          tags: parentTags,
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
          // A variation with its own photos uses those; otherwise it
          // falls back to the product's default image(s).
          const variantImages = v.images.trim()
            ? v.images.split(",").map((s) => s.trim()).filter(Boolean)
            : defaultImageUrls;
          for (const url of variantImages) tags.push(["image", url]);

          const variantTemplate = {
            kind: 30402,
            created_at: Math.floor(Date.now() / 1000),
            tags,
            content: description.trim(),
          };
          const signedVariant = await signEvent(variantTemplate);
          await Promise.any(pool.publish(DEFAULT_RELAYS, signedVariant));

          // If this variation has a stock count, D1 becomes the
          // authoritative tracker for it — reservations at checkout
          // check against this, not the Nostr tag (which only updates
          // when you click "sync stock" later).
          if (v.stock) {
            fetch("/api/inventory/init", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                productCoordinate: `30402:${pubkey}:${variantDTag}`,
                title: `${title.trim()} — ${label}`,
                stock: Number(v.stock),
              }),
            }).catch(() => {});
          }
        }

        setPublishedEventId(signedParent.id);
      } else {
        const tags = [
          ["d", dTag],
          ["title", title.trim()],
          ["price", priceAmount, priceCurrency],
          ["type", publishAsVariable ? "variable" : "simple", format],
          ...baseTags,
        ];
        for (const url of defaultImageUrls) tags.push(["image", url]);

        const template = {
          kind: 30402,
          created_at: Math.floor(Date.now() / 1000),
          tags,
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
    setImageUrls("");
    setShipPrice("");
    setHasVariations(false);
    setVariations([newVariationRow(), newVariationRow()]);
    setEditingDTag(null);
    setStatus("form");
    setPublishedEventId(null);
  }

  function handleEdit(listing) {
    setTitle(listing.title || "");
    setSummary(listing.summary || "");
    setDescription(listing.content || "");
    setPriceAmount(listing.price?.amount || "");
    setPriceCurrency(listing.price?.currency || "sats");
    setImageUrls((listing.images || []).join("\n"));
    setFormat(listing.format || "physical");
    setHasVariations(listing.productType === "variable"); // pre-filled, but editable — see it if it's wrong, fix it right here
    if (listing.shippingCost) {
      setShipPrice(listing.shippingCost.amount || "");
      setShipCurrency(listing.shippingCost.currency || "USD");
    } else if (listing.shippingOptionCoords?.[0]) {
      // Every listing published through this page stores shipping as a
      // separate relay event, not inline — same gap already found and
      // fixed in cart checkout. Resolving it here too, so the edit form
      // doesn't show an empty field for shipping that's actually set.
      setShipPrice("");
      setShipCurrency("USD");
      fetchShippingOption(listing.shippingOptionCoords[0])
        .then((option) => {
          if (option?.price) {
            setShipPrice(option.price.amount || "");
            setShipCurrency(option.price.currency || "USD");
          }
        })
        .catch(() => {});
    } else {
      setShipPrice("");
      setShipCurrency("USD");
    }
    setEditingDTag(listing.dTag);
    setStatus("form");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleCancelEdit() {
    handlePublishAnother();
  }

  return (
    <>
      <Header />

      <main className="admin-fonts flex-1 bg-paper">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <h1 className="text-center font-display text-4xl tracking-wide text-ink">
            {editingDTag ? "EDIT LISTING" : "NEW LISTING"}
          </h1>
          <p className="mt-3 text-center font-serif text-ink/70">
            {editingDTag
              ? "Republishing replaces the existing listing everywhere — same identity, updated details."
              : "Publishes a NIP-99 product listing directly to Nostr. It'll show up in the Shop as soon as relays pick it up — usually within a few seconds."}
          </p>
          {editingDTag && (
            <p className="mt-2 text-center">
              <button
                onClick={handleCancelEdit}
                className="font-display text-xs tracking-widest text-rust hover:text-ink"
              >
                CANCEL EDIT
              </button>
            </p>
          )}

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

          {isRightAccount && (
          <div className="mt-10 grid gap-8 lg:grid-cols-[380px_1fr] lg:items-start">
          <div>

          {allListings && allListings.length > 0 && (
            <div className="border-2 border-ink/20 p-5">
              <h2 className="font-display text-lg tracking-wide text-ink">
                YOUR LISTINGS
              </h2>
              <p className="mt-1 mb-3 font-serif text-xs text-ink/50">
                Deleting publishes a NIP-09 removal request — other apps
                honor it the same way ours does, but it can take a few
                minutes to propagate everywhere.
              </p>
              {allListings
                .filter((l) => !deletedCoords.has(l.coordinate) && l.productType !== "variation")
                .map((l) => (
                  <ListingWithVariations
                    key={l.id}
                    listing={l}
                    allListings={allListings.filter((x) => !deletedCoords.has(x.coordinate))}
                    pubkey={pubkey}
                    signEvent={signEvent}
                    onDeleted={handleDeleted}
                    onEdit={handleEdit}
                  />
                ))}
              {allListings
                .filter((l) => l.productType !== "variation")
                .every((l) => deletedCoords.has(l.coordinate)) && (
                <p className="font-serif text-sm italic text-ink/50">
                  No listings left.
                </p>
              )}
            </div>
          )}

          </div>
          <div>

          {isLoggedIn && isRightAccount && status !== "done" && (
            <div className="space-y-5 font-serif text-sm text-ink/80">
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
                  {editingDTag && (
                    <p className="mb-3 border-2 border-jade/30 bg-jade/5 p-2 font-serif text-xs text-ink/70">
                      Editing an existing variable listing — you don&rsquo;t
                      need to fill in rows below. This checkbox alone is
                      what keeps this listing correctly marked as having
                      size/color options; your actual variations aren&rsquo;t
                      touched by this edit at all.
                    </p>
                  )}
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
                    either field blank if it doesn&rsquo;t apply. Paste
                    photo URLs per row for a color-specific picture — leave
                    it blank to use the product&rsquo;s default photo(s).
                  </p>

                  <div className="space-y-3">
                    {variations.map((v) => (
                      <div key={v.id} className="space-y-2 border-b border-ink/10 pb-3 last:border-b-0">
                        <div className="flex items-center gap-2">
                          <input
                            value={v.size}
                            onChange={(e) => updateVariation(v.id, "size", e.target.value)}
                            placeholder="Size (M)"
                            className="w-16 border-2 border-ink/30 px-2 py-1.5 text-sm focus:border-ink focus:outline-none"
                          />
                          <input
                            value={v.color}
                            onChange={(e) => updateVariation(v.id, "color", e.target.value)}
                            placeholder="Color (Black)"
                            className="w-20 border-2 border-ink/30 px-2 py-1.5 text-sm focus:border-ink focus:outline-none"
                          />
                          <input
                            type="number"
                            value={v.price}
                            onChange={(e) => updateVariation(v.id, "price", e.target.value)}
                            placeholder="Price"
                            className="w-16 border-2 border-ink/30 px-2 py-1.5 text-sm focus:border-ink focus:outline-none"
                          />
                          <input
                            type="number"
                            value={v.stock}
                            onChange={(e) => updateVariation(v.id, "stock", e.target.value)}
                            placeholder="Stock"
                            className="w-16 border-2 border-ink/30 px-2 py-1.5 text-sm focus:border-ink focus:outline-none"
                          />
                          <button
                            onClick={() => removeVariationRow(v.id)}
                            className="font-display text-rust hover:text-ink"
                            aria-label="Remove"
                          >
                            &times;
                          </button>
                        </div>
                        <input
                          value={v.images}
                          onChange={(e) => updateVariation(v.id, "images", e.target.value)}
                          placeholder="Photo URLs for this color, comma separated (optional)"
                          className="w-full border-2 border-ink/30 px-2 py-1.5 font-mono text-xs focus:border-ink focus:outline-none"
                        />
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
                  {hasVariations ? "DEFAULT PHOTOS (used if a variation has none)" : "PHOTOS"}
                </label>
                <textarea
                  value={imageUrls}
                  onChange={(e) => setImageUrls(e.target.value)}
                  rows={3}
                  className="mt-1 w-full resize-none border-2 border-ink/30 px-3 py-2 font-mono text-xs focus:border-ink focus:outline-none"
                  placeholder="https://...&#10;https://..."
                />
                <p className="mt-1 text-xs italic text-ink/50">
                  One URL per line — needs to already be hosted somewhere
                  (nostr.build, etc). The first one is used as the main
                  photo; buyers can click through the rest.
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
                  ? editingDTag
                    ? "UPDATING…"
                    : "PUBLISHING…"
                  : editingDTag
                  ? "UPDATE LISTING"
                  : hasVariations
                  ? `PUBLISH LISTING + ${variations.filter((v) => v.price).length} VARIATIONS`
                  : "PUBLISH LISTING"}
              </button>
            </div>
          )}

          {status === "done" && (
            <div className="space-y-4 text-center font-serif text-ink/80">
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
          </div>
          )}
        </div>
      </main>

      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
    </>
  );
}
