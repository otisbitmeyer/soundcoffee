"use client";

import { useState } from "react";
import QRCode from "qrcode";
import { SimplePool } from "nostr-tools/pool";
import { useAuth } from "@/context/AuthContext";
import { useProfile } from "@/hooks/useProfile";
import { resolveLud16, requestPlainInvoice } from "@/lib/zap";
import { giftWrapForBoth } from "@/lib/nip17";
import { DEFAULT_RELAYS } from "@/lib/relays";
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

export default function CheckoutModal({ listing, sellerPubkey, onClose }) {
  const { isLoggedIn, pubkey, signEvent, nip44Encrypt } = useAuth();
  const { profile: sellerProfile } = useProfile(sellerPubkey);
  const { btcUsdPrice, loading: priceLoading, error: priceError } = useBtcUsdPrice();

  const [showLogin, setShowLogin] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [address, setAddress] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("form"); // form | working | invoice | done | error
  const [error, setError] = useState("");
  const [invoice, setInvoice] = useState(null);
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [orderId, setOrderId] = useState(null);
  const [brantaLink, setBrantaLink] = useState(null);

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

  async function sendGiftWrapped(eventTemplate) {
    const [toSeller, toSelf] = await giftWrapForBoth({
      eventTemplate,
      senderPubkey: pubkey,
      recipientPubkey: sellerPubkey,
      authNip44Encrypt: nip44Encrypt,
      authSignEvent: signEvent,
    });
    await Promise.any(getPool().publish(DEFAULT_RELAYS, toSeller));
    await Promise.any(getPool().publish(DEFAULT_RELAYS, toSelf));
  }

  async function handlePlaceOrder() {
    if (!isLoggedIn) {
      setShowLogin(true);
      return;
    }
    if (!totalSats) {
      setError("This item isn't priced in sats yet, so Lightning checkout isn't available for it.");
      setStatus("error");
      return;
    }
    if (requiresShipping && !address.trim()) {
      setError("This is a physical item — a shipping address is needed.");
      setStatus("error");
      return;
    }
    if (!sellerProfile?.lud16) {
      setError("The seller doesn't have a Lightning address set up yet.");
      setStatus("error");
      return;
    }

    setStatus("working");
    setError("");

    try {
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
      if (address.trim()) orderTags.push(["address", address.trim()]);
      if (email.trim()) orderTags.push(["email", email.trim()]);
      if (shippingCoord) orderTags.push(["shipping", shippingCoord]);

      await sendGiftWrapped({
        kind: 16,
        tags: orderTags,
        content: notes.trim(),
      });

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
          pubkey,
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
    }
  }

  async function handleConfirmPaid() {
    setStatus("working");
    setError("");
    try {
      await sendGiftWrapped({
        kind: 17,
        tags: [
          ["p", sellerPubkey],
          ["subject", "order-receipt"],
          ["order", orderId],
          ["payment", "lightning", invoice, ""],
          ["amount", String(totalSats)],
        ],
        content: "Paid via Lightning.",
      });
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
                <textarea
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  rows={3}
                  className="mt-1 w-full resize-none border-2 border-ink/30 px-3 py-2 font-serif text-sm text-ink focus:border-ink focus:outline-none"
                  placeholder="Street, city, state, zip, country"
                />
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

              <button
                onClick={handlePlaceOrder}
                disabled={status === "working" || !totalSats}
                className="w-full border-2 border-ink bg-ink px-4 py-3 font-display text-sm tracking-widest text-paper transition hover:bg-rust hover:border-rust disabled:opacity-50"
              >
                {status === "working" ? "PLACING ORDER…" : "PLACE ORDER & GET INVOICE"}
              </button>
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
                They&rsquo;ll follow up with shipping details via Nostr DM.
              </p>
              <p className="font-serif text-xs italic text-ink/50">
                Order ID: {orderId}
              </p>
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
