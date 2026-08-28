"use client";

import { useState, useEffect } from "react";
import { isWeblnAvailable, payInvoiceViaWebln } from "@/lib/webln";
import { payInvoiceViaNwc } from "@/lib/nwc";

const NWC_STORAGE_KEY = "sound-coffee-nwc-uri";

/**
 * Offers to pay a given invoice directly from a connected wallet —
 * browser extension (WebLN) or Nostr Wallet Connect — as a faster
 * alternative to scanning/copying the QR code below it. Calls onPaid()
 * immediately on success, since a resolved payment IS confirmation,
 * no need to wait for the usual polling.
 */
export default function WalletConnectPay({ invoice, onPaid }) {
  const [weblnAvailable, setWeblnAvailable] = useState(false);
  const [weblnStatus, setWeblnStatus] = useState("idle"); // idle | working | error
  const [weblnError, setWeblnError] = useState("");

  const [showNwcInput, setShowNwcInput] = useState(false);
  const [nwcUri, setNwcUri] = useState("");
  const [rememberNwc, setRememberNwc] = useState(true);
  const [nwcStatus, setNwcStatus] = useState("idle"); // idle | working | error
  const [nwcError, setNwcError] = useState("");

  useEffect(() => {
    setWeblnAvailable(isWeblnAvailable());
    try {
      const saved = localStorage.getItem(NWC_STORAGE_KEY);
      if (saved) setNwcUri(saved);
    } catch {
      // localStorage unavailable — not a big deal, just no autofill
    }
  }, []);

  async function handleWeblnPay() {
    setWeblnStatus("working");
    setWeblnError("");
    try {
      await payInvoiceViaWebln(invoice);
      onPaid();
    } catch (e) {
      setWeblnError(e.message || "Payment failed or was cancelled.");
      setWeblnStatus("error");
    }
  }

  async function handleNwcPay() {
    setNwcStatus("working");
    setNwcError("");
    try {
      await payInvoiceViaNwc(nwcUri, invoice);
      if (rememberNwc) {
        try {
          localStorage.setItem(NWC_STORAGE_KEY, nwcUri);
        } catch {
          // best-effort only
        }
      }
      onPaid();
    } catch (e) {
      setNwcError(e.message || "Payment failed.");
      setNwcStatus("error");
    }
  }

  return (
    <div className="space-y-2">
      {weblnAvailable && (
        <div>
          <button
            onClick={handleWeblnPay}
            disabled={weblnStatus === "working"}
            className="w-full border-2 border-jade bg-jade px-4 py-2.5 font-display text-sm tracking-widest text-paper hover:bg-ink hover:border-ink disabled:opacity-50"
          >
            {weblnStatus === "working" ? "CONFIRM IN YOUR WALLET…" : "⚡ PAY WITH BROWSER WALLET"}
          </button>
          {weblnError && <p className="mt-1 text-xs text-rust">{weblnError}</p>}
        </div>
      )}

      <div>
        <button
          onClick={() => setShowNwcInput((v) => !v)}
          className="w-full border-2 border-ink/30 px-4 py-2 font-display text-xs tracking-widest text-ink/70 hover:border-ink hover:text-ink"
        >
          {showNwcInput ? "HIDE NOSTR WALLET CONNECT" : "PAY VIA NOSTR WALLET CONNECT"}
        </button>
        {showNwcInput && (
          <div className="mt-2 space-y-2 border-2 border-ink/10 p-3">
            <textarea
              value={nwcUri}
              onChange={(e) => setNwcUri(e.target.value)}
              placeholder="nostr+walletconnect://..."
              rows={2}
              className="w-full resize-none border-2 border-ink/30 bg-white p-2 font-mono text-xs text-ink focus:border-ink focus:outline-none"
            />
            <label className="flex items-center gap-2 text-xs text-ink/60">
              <input
                type="checkbox"
                checked={rememberNwc}
                onChange={(e) => setRememberNwc(e.target.checked)}
              />
              Remember this connection on this device
            </label>
            <button
              onClick={handleNwcPay}
              disabled={nwcStatus === "working" || !nwcUri.trim()}
              className="w-full border-2 border-ink bg-ink px-4 py-2 font-display text-xs tracking-widest text-paper hover:bg-rust hover:border-rust disabled:opacity-50"
            >
              {nwcStatus === "working" ? "WAITING FOR YOUR WALLET…" : "CONNECT & PAY"}
            </button>
            {nwcError && <p className="text-xs text-rust">{nwcError}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
