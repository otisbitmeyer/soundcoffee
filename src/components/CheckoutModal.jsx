"use client";

import { useState, useRef } from "react";
import QRCode from "qrcode";
import { SimplePool } from "nostr-tools/pool";
import { finalizeEvent } from "nostr-tools/pure";
import { getConversationKey, encrypt as nip44EncryptRaw } from "nostr-tools/nip44";
import { useAuth } from "@/context/AuthContext";
import { useProfile } from "@/hooks/useProfile";
import { resolveLud16, requestPlainInvoice } from "@/lib/zap";
import { giftWrapForBoth } from "@/lib/nip17";
import { DEFAULT_RELAYS, getDmRelaysFor } from "@/lib/relays";
import { useBtcUsdPrice, usdToSats } from "@/hooks/useBtcUsdPrice";
import { useShippingOption } from "@/hooks/useShippingOption";
import LoginModal from "./LoginModal";

let pool;
function getPool() {
  if (!pool) pool = new SimplePool();
  return pool;
}

function satsFromSatsOrBtc(price) {
  const currency = (price.currency || "").toLowerCase();
  if (currency === "sat" || currency === "sats") return Math.round(Number(price.amount));
  if (currency === "btc") return Math.round(Number(price.amount) * 100_000_000);
  return null;
}

// The Gamma spec's "address" tag is a single freeform string — no
// separate city/state/zip fields exist on the wire. We still collect
// them as distinct inputs for a much better checkout experience, and
// combine them here into one clean string right before it goes into the
// actual order message, so every other Gamma-compatible app can still
// read it correctly.
function formatAddress({ line1, line2, city, stateRegion, zip, country }) {
  const line3 = [city, stateRegion, zip].filter(Boolean).join(", ");
  return [line1, line2, line3, country].filter((s) => s && s.trim()).join("\n");
}

export default function CheckoutModal({ listing, sellerPubkey, onClose }) {
  const { isLoggedIn, pubkey, npub, signEvent, nip44Encrypt, createGuestKeys } = useAuth();
  const { profile: sellerProfile } = useProfile(sellerPubkey);
  const { btcUsdPrice, loading: priceLoading, error: priceError } = useBtcUsdPrice();

  const [showLogin, setShowLogin] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [stateRegion, setStateRegion] = useState("");
  const [zip, setZip] = useState("");
  const [country, setCountry] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("form"); // form | working | invoice | done | error
  const [error, setError] = useState("");
  const [invoice, setInvoice] = useState(null);
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [orderId, setOrderId] = useState(null);
  const [brantaLink, setBrantaLink] = useState(null);
  const [guestNsec, setGuestNsec] = useState(null);

  // A React state check alone isn't fast enough to stop a very quick
  // double-click — the button doesn't actually disable until after a
  // re-render. This ref updates synchronously, so it can't be raced.
  const submittingRef = useRef(false);

  const shippingCoord = listing.shippingOptionCoords?.[0] || null;
  const { option: shippingOption, loading: shippingLoading } = useShippingOption(shippingCoord);

  const isFiatUsd = listing.price && (listing.price.currency || "").toLowerCase() === "usd";
  const directSats = listing.price ? satsFromSatsOrBtc(listing.price) : null;
  const unitSats = directSats ?? (isFiatUsd ? usdToSats(listing.price.amount, btcUsdPrice) : null);

  const shippingIsFiatUsd =
    shippingOption?.price && (shippingOption.price.currency || "").toLowerCase() === "usd";
  const shippingSats = shippingOption?.price
    ? (satsFromSatsOrBtc(shippingOption.price) ??
       (shippingIsFiatUsd ? usdToSats(shippingOption.price.amount, btcUsdPrice) : null))
    : 0;

  const totalSats = unitSats ? unitSats * quantity + (shippingSats || 0) : null;
  const requiresShipping = listing.format === "physical";

  // For card payments, Stripe needs a USD amount regardless of how the
  // item is priced. If already USD, use that directly (more accurate
  // than converting through sats and back). Otherwise derive USD from
  // the same live BTC price used everywhere else on the site.
  const totalUsdCents = isFiatUsd
    ? Math.round(
        (Number(listing.price.amount) * quantity +
          (shippingIsFiatUsd ? Number(shippingOption.price.amount) : 0)) *
          100
      )
    : totalSats && btcUsdPrice
    ? Math.round((totalSats / 100_000_000) * btcUsdPrice * 100)
    : null;

  // Returns { pubkey, signEvent, nip44Encrypt } for whoever's checking
  // out — a real logged-in user's context functions, OR a freshly
  // generated guest identity. Guest signing/encrypting is done directly
  // against the just-generated key rather than through the context's
  // signEvent/nip44Encrypt, because React state updates aren't visible
  // synchronously — those functions wouldn't see the new key until after
  // a re-render, which is too late for the rest of this same call.
  async function ensureIdentity() {
    if (isLoggedIn) {
      return { pubkey, signEvent, nip44Encrypt, isGuest: false };
    }
    const guest = createGuestKeys();
    setGuestNsec(guest.nsec);
    return {
      pubkey: guest.pubkey,
      isGuest: true,
      signEvent: async (template) => finalizeEvent(template, guest.secretKey),
      nip44Encrypt: async (recipientPubkey, plaintext) => {
        const conversationKey = getConversationKey(guest.secretKey, recipientPubkey);
        return nip44EncryptRaw(plaintext, conversationKey);
      },
    };
  }

  async function sendGiftWrapped(eventTemplate, identity) {
    const [toSeller, toSelf] = await giftWrapForBoth({
      eventTemplate,
      senderPubkey: identity.pubkey,
      recipientPubkey: sellerPubkey,
      authNip44Encrypt: identity.nip44Encrypt,
      authSignEvent: identity.signEvent,
    });

    // Publish to wherever the seller actually said they read DMs (NIP-17
    // kind 10050), not just our own generic relay list — otherwise the
    // message can land somewhere they never check. Include our defaults
    // too, for redundancy in case they haven't set a DM relay list.
    const sellerDmRelays = await getDmRelaysFor(sellerPubkey);
    const publishTargets = [...new Set([...sellerDmRelays, ...DEFAULT_RELAYS])];

    await Promise.any(getPool().publish(publishTargets, toSeller));
    await Promise.any(getPool().publish(DEFAULT_RELAYS, toSelf));
  }

  // Combined into the single spec-compliant string wherever it's actually
  // used for validation or sending.
  const combinedAddress = formatAddress({
    line1: addressLine1,
    line2: addressLine2,
    city,
    stateRegion,
    zip,
    country,
  });

  async function handlePlaceOrder(paymentMethod) {
    if (submittingRef.current) return; // already placing this order — ignore extra clicks
    if (!totalSats) {
      setError("This item isn't priced yet, so checkout isn't available for it.");
      setStatus("error");
      return;
    }
    if (requiresShipping && !combinedAddress) {
      setError("This is a physical item — a shipping address is needed.");
      setStatus("error");
      return;
    }
    if (paymentMethod === "lightning" && !sellerProfile?.lud16) {
      setError("The seller doesn't have a Lightning address set up yet.");
      setStatus("error");
      return;
    }
    if (paymentMethod === "card" && !totalUsdCents) {
      setError("Couldn't determine a USD price for card payment right now — try again in a moment.");
      setStatus("error");
      return;
    }

    submittingRef.current = true;
    setStatus("working");
    setError("");

    try {
      const identity = await ensureIdentity();
      const newOrderId = crypto.randomUUID();
      setOrderId(newOrderId);

      const orderTags = [
        ["p", sellerPubkey],
        ["subject", `Order: ${listing.title}`],
        ["type", "1"],
        ["order", newOrderId],
        ["amount", String(totalSats)],
        ["item", listing.coordinate, String(quantity)],
      ];
      if (combinedAddress) orderTags.push(["address", combinedAddress]);
      if (email.trim()) orderTags.push(["email", email.trim()]);
      if (shippingCoord) orderTags.push(["shipping", shippingCoord]);

      await sendGiftWrapped(
        {
          kind: 16,
          tags: orderTags,
          content: notes.trim(),
        },
        identity
      );

      // Email notification — a reliable fallback alongside the DM, since
      // not every Nostr client supports NIP-17 gift-wrapped messages yet.
      // Especially important for guest checkout — it's their main durable
      // record if they don't hang onto the guest key.
      fetch("/api/notify-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: newOrderId,
          itemTitle: listing.title,
          quantity,
          amountSats: totalSats,
          buyerNpub: identity.isGuest ? null : npub,
          buyerEmail: email.trim() || null,
          address: combinedAddress || null,
          notes: notes.trim() || null,
        }),
      }).catch(() => {});

      if (paymentMethod === "card") {
        // Register the pending payment first (no verifyUrl — Stripe's
        // webhook confirms this one directly, not the LUD-21 poller),
        // then send the buyer to Stripe's hosted checkout. Same
        // membership-tracking pipeline as Lightning from here on.
        await fetch("/api/pending-payment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: newOrderId,
            type: "purchase",
            pubkey: identity.pubkey,
            sellerPubkey,
            invoice: `stripe:${newOrderId}`,
            verifyUrl: null,
            amountSats: totalSats,
          }),
        });

        const origin = window.location.origin + window.location.pathname;
        const res = await fetch("/api/create-checkout-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderId: newOrderId,
            itemTitle: listing.title,
            amountUsdCents: totalUsdCents,
            buyerEmail: email.trim() || null,
            successUrl: `${origin}?stripe_success=1&order=${newOrderId}`,
            cancelUrl: `${origin}?stripe_cancel=1`,
          }),
        });
        const session = await res.json();
        if (!session.url) throw new Error(session.error || "Couldn't start card checkout.");

        window.location.href = session.url; // leaves the page — Stripe takes over from here
        return;
      }

      // Lightning path
      const lnurlData = await resolveLud16(sellerProfile.lud16);
      const { pr, verify } = await requestPlainInvoice({
        callback: lnurlData.callback,
        amountMsats: totalSats * 1000,
        comment: `Order ${newOrderId}`,
      });

      // Register with our own backend so settlement gets tracked toward
      // club membership. Best-effort — if this fails, checkout still
      // works, it just falls back fully to the buyer's own "I've paid"
      // confirmation.
      fetch("/api/pending-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: newOrderId,
          type: "purchase",
          pubkey: identity.pubkey,
          sellerPubkey,
          invoice: pr,
          verifyUrl: verify,
          amountSats: totalSats,
        }),
      }).catch(() => {});

      const qr = await QRCode.toDataURL(pr.toUpperCase(), { margin: 1, width: 320 });

      setInvoice(pr);
      setQrDataUrl(qr);
      setStatus("invoice");

      // Best-effort — if Branta isn't configured yet, this just silently
      // does nothing and the invoice/QR flow works exactly as before.
      fetch("/api/branta/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoice: pr }),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => data?.verifyLink && setBrantaLink(data.verifyLink))
        .catch(() => {});
    } catch (e) {
      setError(e.message || "Something went wrong placing the order.");
      setStatus("error");
    } finally {
      submittingRef.current = false;
    }
  }

  async function handleConfirmPaid() {
    setStatus("working");
    setError("");
    try {
      // By now, if this was a guest checkout, the context has already
      // re-rendered with the guest identity from handlePlaceOrder — so
      // this correctly reuses it rather than creating a second one.
      const identity = await ensureIdentity();
      await sendGiftWrapped(
        {
          kind: 17,
          tags: [
            ["p", sellerPubkey],
            ["subject", "order-receipt"],
            ["order", orderId],
            ["payment", "lightning", invoice, ""],
            ["amount", String(totalSats)],
          ],
          content: "Paid via Lightning.",
        },
        identity
      );

      // Also tell our own backend directly — this is what actually
      // updates club membership stats. Best-effort: if this fails, the
      // order/receipt DM still went through.
      fetch("/api/confirm-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: orderId }),
      }).catch(() => {});

      setStatus("done");
    } catch (e) {
      setError(e.message || "Order was placed, but sending the receipt failed. You can still contact the seller with your order ID.");
      setStatus("error");
    }
  }

  if (showLogin) {
    return <LoginModal onClose={() => setShowLogin(false)} />;
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-ink/80 px-4 py-8">
      <div className="w-full max-w-md border-2 border-ink bg-paper">
        <div className="flex items-center justify-between border-b-2 border-ink px-6 py-4">
          <h2 className="font-display text-xl tracking-wide text-ink">
            {status === "done" ? "ORDER SENT" : "CHECKOUT"}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="font-display text-2xl leading-none text-ink hover:text-rust"
          >
            &times;
          </button>
        </div>

        <div className="px-6 py-6">
          {(status === "form" || status === "working" || status === "error") && (
            <div className="space-y-4 font-serif text-sm text-ink/80">
              <div>
                <h3 className="font-display text-lg text-ink">{listing.title}</h3>
                {directSats ? (
                  <p className="mt-1 text-ink/60">{directSats.toLocaleString()} sats each</p>
                ) : isFiatUsd ? (
                  priceLoading ? (
                    <p className="mt-1 text-ink/50 italic">Fetching current sats price…</p>
                  ) : priceError || !unitSats ? (
                    <p className="mt-1 text-rust">
                      Couldn&rsquo;t fetch a live sats price right now &mdash;
                      try again in a moment.
                    </p>
                  ) : (
                    <p className="mt-1 text-ink/60">
                      ${listing.price.amount} &asymp; {unitSats.toLocaleString()} sats each{" "}
                      <span className="text-ink/40">
                        (${btcUsdPrice.toLocaleString()}/BTC)
                      </span>
                    </p>
                  )
                ) : (
                  <p className="mt-1 text-rust">
                    Priced in {listing.price?.currency || "an unsupported currency"} —
                    Lightning checkout needs a sats or USD price.
                  </p>
                )}
              </div>

              {!isLoggedIn && (
                <p className="border border-ink/10 bg-ink/5 px-3 py-2 text-xs text-ink/60">
                  No Nostr account needed — placing this order creates a
                  one-time identity just for it, automatically.{" "}
                  <button
                    onClick={() => setShowLogin(true)}
                    className="text-jade underline hover:text-ink"
                  >
                    Already have a Nostr identity? Log in instead
                  </button>
                </p>
              )}

              <div>
                <label className="block font-display text-xs tracking-widest text-ink/60">
                  QUANTITY
                </label>
                <input
                  type="number"
                  min="1"
                  value={quantity}
                  onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
                  className="mt-1 w-24 border-2 border-ink/30 px-3 py-2 font-display text-sm text-ink focus:border-ink focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-display text-xs tracking-widest text-ink/60">
                  SHIPPING ADDRESS{requiresShipping ? "" : " (OPTIONAL)"}
                </label>
                <div className="mt-1 space-y-2">
                  <input
                    value={addressLine1}
                    onChange={(e) => setAddressLine1(e.target.value)}
                    placeholder="Street address"
                    className="w-full border-2 border-ink/30 px-3 py-2 font-serif text-sm text-ink focus:border-ink focus:outline-none"
                  />
                  <input
                    value={addressLine2}
                    onChange={(e) => setAddressLine2(e.target.value)}
                    placeholder="Apt, suite, etc. (optional)"
                    className="w-full border-2 border-ink/30 px-3 py-2 font-serif text-sm text-ink focus:border-ink focus:outline-none"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder="City"
                      className="border-2 border-ink/30 px-3 py-2 font-serif text-sm text-ink focus:border-ink focus:outline-none"
                    />
                    <input
                      value={stateRegion}
                      onChange={(e) => setStateRegion(e.target.value)}
                      placeholder="State / Region"
                      className="border-2 border-ink/30 px-3 py-2 font-serif text-sm text-ink focus:border-ink focus:outline-none"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      value={zip}
                      onChange={(e) => setZip(e.target.value)}
                      placeholder="ZIP / Postal code"
                      className="border-2 border-ink/30 px-3 py-2 font-serif text-sm text-ink focus:border-ink focus:outline-none"
                    />
                    <input
                      value={country}
                      onChange={(e) => setCountry(e.target.value)}
                      placeholder="Country"
                      className="border-2 border-ink/30 px-3 py-2 font-serif text-sm text-ink focus:border-ink focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block font-display text-xs tracking-widest text-ink/60">
                  EMAIL (OPTIONAL)
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full border-2 border-ink/30 px-3 py-2 font-serif text-sm text-ink focus:border-ink focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-display text-xs tracking-widest text-ink/60">
                  NOTES (OPTIONAL)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="mt-1 w-full resize-none border-2 border-ink/30 px-3 py-2 font-serif text-sm text-ink focus:border-ink focus:outline-none"
                />
              </div>

              {shippingCoord && (
                <div className="border-t-2 border-ink/10 pt-3 text-xs text-ink/60">
                  {shippingLoading ? (
                    "Loading shipping option…"
                  ) : shippingOption ? (
                    <p>
                      {shippingOption.title}
                      {shippingSats ? ` — ${shippingSats.toLocaleString()} sats` : " — free"}
                    </p>
                  ) : (
                    "Couldn't load the shipping option for this listing."
                  )}
                </div>
              )}

              {totalSats && (
                <p className="border-t-2 border-ink/10 pt-3 font-display text-lg text-ink">
                  Total: {totalSats.toLocaleString()} sats
                  {shippingSats ? (
                    <span className="block text-xs font-serif text-ink/50">
                      (includes {shippingSats.toLocaleString()} sats shipping)
                    </span>
                  ) : null}
                </p>
              )}

              {error && (
                <p className="border-2 border-rust bg-rust/10 px-3 py-2 text-rust">
                  {error}
                </p>
              )}

              <p className="font-serif text-xs italic text-ink/50">
                Placing this order sends an encrypted message (NIP-17) to
                the seller with your order details — nobody else can read
                it.
              </p>

              <div className="space-y-2">
                <button
                  onClick={() => handlePlaceOrder("lightning")}
                  disabled={status === "working" || !totalSats}
                  className="w-full border-2 border-ink bg-ink px-4 py-3 font-display text-sm tracking-widest text-paper transition hover:bg-rust hover:border-rust disabled:opacity-50"
                >
                  {status === "working"
                    ? "PLACING ORDER…"
                    : `⚡ PAY WITH LIGHTNING${totalSats ? ` (${totalSats.toLocaleString()} sats)` : ""}`}
                </button>
                <button
                  onClick={() => handlePlaceOrder("card")}
                  disabled={status === "working" || !totalUsdCents}
                  className="w-full border-2 border-ink px-4 py-3 font-display text-sm tracking-widest text-ink transition hover:border-jade hover:text-jade disabled:opacity-50"
                >
                  {status === "working"
                    ? "PLACING ORDER…"
                    : `💳 PAY WITH CARD${totalUsdCents ? ` ($${(totalUsdCents / 100).toFixed(2)})` : ""}`}
                </button>
              </div>
            </div>
          )}

          {status === "invoice" && invoice && (
            <div className="space-y-4 text-center">
              <p className="font-serif text-sm text-ink/70">
                Order placed &mdash; the seller has been sent your order
                details privately. Pay the invoice below to complete it.
              </p>
              <img
                src={qrDataUrl}
                alt="Lightning invoice QR code"
                className="mx-auto border-2 border-ink"
              />
              <textarea
                readOnly
                value={invoice}
                onFocus={(e) => e.target.select()}
                className="w-full resize-none border-2 border-ink bg-white p-2 font-mono text-xs text-ink"
                rows={3}
              />
              {brantaLink && (
                <a
                  href={brantaLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block font-serif text-xs text-jade underline"
                >
                  ✓ Verify this is really Sound Coffee (via Branta)
                </a>
              )}
              <button
                onClick={() => navigator.clipboard.writeText(invoice)}
                className="w-full border-2 border-ink px-4 py-2 font-display text-sm tracking-widest text-ink hover:border-jade hover:text-jade"
              >
                COPY INVOICE
              </button>
              <button
                onClick={handleConfirmPaid}
                className="w-full border-2 border-ink bg-ink px-4 py-3 font-display text-sm tracking-widest text-paper hover:bg-jade hover:border-jade"
              >
                I&rsquo;VE PAID
              </button>
              <p className="font-serif text-xs italic text-ink/50">
                Order ID: {orderId}
              </p>
            </div>
          )}

          {status === "done" && (
            <div className="space-y-3 text-center font-serif text-sm text-ink/80">
              <p className="text-2xl">✓</p>
              <p>
                Your payment confirmation has been sent to the seller.
                They&rsquo;ll follow up with shipping details via Nostr DM
                {email.trim() ? " and email" : ""}.
              </p>
              <p className="font-serif text-xs italic text-ink/50">
                Order ID: {orderId}
              </p>

              {guestNsec && (
                <div className="border-2 border-ink/10 bg-ink/5 p-3 text-left text-xs">
                  <p className="font-display tracking-widest text-ink/60">
                    ABOUT YOUR ORDER IDENTITY
                  </p>
                  <p className="mt-1 text-ink/70">
                    We created a one-time Nostr key just for this order, so
                    you didn&rsquo;t need an account to buy. You don&rsquo;t
                    need to do anything — we&rsquo;ll email you about your
                    order{email.trim() ? "" : " if you left an email"}. If
                    you&rsquo;d ever like to check for messages about this
                    order yourself, this key can be imported into any
                    Nostr app:
                  </p>
                  <textarea
                    readOnly
                    value={guestNsec}
                    onFocus={(e) => e.target.select()}
                    className="mt-2 w-full resize-none border-2 border-ink bg-white p-2 font-mono text-xs text-ink"
                    rows={2}
                  />
                </div>
              )}

              <button
                onClick={onClose}
                className="mt-2 w-full border-2 border-ink px-4 py-2 font-display text-sm tracking-widest text-ink hover:border-jade hover:text-jade"
              >
                CLOSE
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
