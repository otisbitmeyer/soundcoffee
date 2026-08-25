"use client";

import { useState, useEffect, useRef } from "react";
import QRCode from "qrcode";
import { useAuth } from "@/context/AuthContext";
import { useProfile } from "@/hooks/useProfile";
import { resolveLud16, buildZapRequestTemplate, requestZapInvoice } from "@/lib/zap";
import { DEFAULT_RELAYS } from "@/lib/relays";
import LoginModal from "./LoginModal";

const PRESET_AMOUNTS = [21, 100, 1000, 5000];
const POLL_INTERVAL_MS = 3000;

export default function ZapModal({
  recipientPubkey,
  label = "Send a zap",
  eventId,
  aTag,
  onClose,
}) {
  const { isLoggedIn, pubkey, signEvent } = useAuth();
  const { profile } = useProfile(recipientPubkey);

  const [showLogin, setShowLogin] = useState(false);
  const [amount, setAmount] = useState(100);
  const [customAmount, setCustomAmount] = useState("");
  const [comment, setComment] = useState("");
  const [status, setStatus] = useState("idle"); // idle | working | ready | paid | error
  const [invoice, setInvoice] = useState(null);
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [error, setError] = useState("");
  const [canAutoDetect, setCanAutoDetect] = useState(true);
  const pollRef = useRef(null);

  const effectiveAmount = customAmount ? Number(customAmount) : amount;

  useEffect(() => {
    return () => clearInterval(pollRef.current);
  }, []);

  function startPolling(verifyUrl) {
    if (!verifyUrl) {
      setCanAutoDetect(false);
      return;
    }
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(verifyUrl);
        const data = await res.json();
        if (data.settled) {
          clearInterval(pollRef.current);
          setStatus("paid");
        }
      } catch {
        // network hiccup — just try again next tick
      }
    }, POLL_INTERVAL_MS);
  }

  async function handleZap() {
    if (!isLoggedIn) {
      setShowLogin(true);
      return;
    }
    if (!profile?.lud16) {
      setError("This npub doesn't have a Lightning address set up yet.");
      setStatus("error");
      return;
    }
    if (!effectiveAmount || effectiveAmount <= 0) {
      setError("Enter a valid amount.");
      setStatus("error");
      return;
    }

    setStatus("working");
    setError("");

    try {
      const lnurlData = await resolveLud16(profile.lud16);
      const amountMsats = effectiveAmount * 1000;

      const template = buildZapRequestTemplate({
        recipientPubkey,
        amountMsats,
        relays: DEFAULT_RELAYS,
        comment,
        eventId,
        aTag,
      });

      const signed = await signEvent(template);

      const { pr, verify } = await requestZapInvoice({
        callback: lnurlData.callback,
        amountMsats,
        signedZapRequest: signed,
      });

      // Register with our own backend so settlement gets tracked toward
      // club membership even if this Lightning provider never publishes
      // a proper NIP-57 zap receipt to relays.
      fetch("/api/pending-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: `${signed.id}`,
          type: "zap",
          pubkey,
          sellerPubkey: recipientPubkey,
          invoice: pr,
          verifyUrl: verify,
          amountSats: effectiveAmount,
        }),
      }).catch(() => {});

      const qr = await QRCode.toDataURL(pr.toUpperCase(), { margin: 1, width: 320 });

      setInvoice(pr);
      setQrDataUrl(qr);
      setStatus("ready");
      startPolling(verify);
    } catch (e) {
      setError(e.message || "Something went wrong generating the invoice.");
      setStatus("error");
    }
  }

  if (showLogin) {
    return <LoginModal onClose={() => setShowLogin(false)} />;
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/80 px-4">
      <div className="w-full max-w-md border-2 border-ink bg-paper">
        <div className="flex items-center justify-between border-b-2 border-ink px-6 py-4">
          <h2 className="font-display text-xl tracking-wide text-ink">
            {status === "paid" ? "ZAP RECEIVED" : label.toUpperCase()}
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
          {(status === "idle" || status === "working" || status === "error") && (
            <div className="space-y-4 font-serif text-sm text-ink/80">
              <div>
                <label className="block font-display text-xs tracking-widest text-ink/60">
                  AMOUNT (SATS)
                </label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {PRESET_AMOUNTS.map((a) => (
                    <button
                      key={a}
                      onClick={() => {
                        setAmount(a);
                        setCustomAmount("");
                      }}
                      className={`border-2 px-3 py-1.5 font-display text-sm ${
                        amount === a && !customAmount
                          ? "border-ink bg-ink text-paper"
                          : "border-ink/30 text-ink hover:border-ink"
                      }`}
                    >
                      {a}
                    </button>
                  ))}
                  <input
                    type="number"
                    min="1"
                    placeholder="Custom"
                    value={customAmount}
                    onChange={(e) => setCustomAmount(e.target.value)}
                    className="w-24 border-2 border-ink/30 px-2 py-1.5 font-display text-sm text-ink focus:border-ink focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block font-display text-xs tracking-widest text-ink/60">
                  COMMENT (OPTIONAL)
                </label>
                <input
                  type="text"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  className="mt-1 w-full border-2 border-ink/30 px-3 py-2 font-serif text-sm text-ink focus:border-ink focus:outline-none"
                  placeholder="Great episode!"
                />
              </div>

              {error && (
                <p className="border-2 border-rust bg-rust/10 px-3 py-2 text-rust">
                  {error}
                </p>
              )}

              <button
                onClick={handleZap}
                disabled={status === "working"}
                className="w-full border-2 border-ink bg-ink px-4 py-3 font-display text-sm tracking-widest text-paper transition hover:bg-rust hover:border-rust disabled:opacity-50"
              >
                {status === "working" ? "GENERATING INVOICE…" : "⚡ ZAP"}
              </button>
            </div>
          )}

          {status === "ready" && invoice && (
            <div className="space-y-4 text-center">
              <img
                src={qrDataUrl}
                alt="Lightning invoice QR code"
                className="mx-auto border-2 border-ink"
              />
              <p className="font-serif text-sm text-ink/70">
                Scan with any Lightning wallet, or copy the invoice below.
              </p>
              {canAutoDetect ? (
                <p className="flex items-center justify-center gap-2 font-serif text-xs italic text-ink/50">
                  <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-jade" />
                  Watching for payment&hellip; this updates automatically.
                </p>
              ) : (
                <p className="font-serif text-xs italic text-ink/50">
                  This wallet doesn&rsquo;t support automatic confirmation
                  &mdash; once you&rsquo;ve paid, you can just close this.
                </p>
              )}
              <textarea
                readOnly
                value={invoice}
                onFocus={(e) => e.target.select()}
                className="w-full resize-none border-2 border-ink bg-white p-2 font-mono text-xs text-ink"
                rows={3}
              />
              <button
                onClick={() => navigator.clipboard.writeText(invoice)}
                className="w-full border-2 border-ink px-4 py-2 font-display text-sm tracking-widest text-ink hover:border-jade hover:text-jade"
              >
                COPY INVOICE
              </button>
            </div>
          )}

          {status === "paid" && (
            <div className="space-y-3 text-center font-serif text-ink/80">
              <p className="text-4xl">⚡✓</p>
              <p className="font-display text-xl text-jade">
                PAYMENT RECEIVED
              </p>
              <p>Thanks for the boost!</p>
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
