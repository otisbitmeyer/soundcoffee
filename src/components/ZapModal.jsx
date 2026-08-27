"use client";

import { useState, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import QRCode from "qrcode";
import { SimplePool } from "nostr-tools/pool";
import { useProfile } from "@/hooks/useProfile";
import { useEnsureIdentity } from "@/hooks/useEnsureIdentity";
import { resolveLud16, buildZapRequestTemplate, requestZapInvoice } from "@/lib/zap";
import { episodeTags, showTags } from "@/lib/episodeId";
import { DEFAULT_RELAYS } from "@/lib/relays";
import LoginModal from "./LoginModal";

let publishPool;
function getPublishPool() {
  if (!publishPool) publishPool = new SimplePool();
  return publishPool;
}

const PRESET_AMOUNTS = [21, 100, 1000, 5000];
const POLL_INTERVAL_MS = 3000;

export default function ZapModal({
  recipientPubkey,
  label = "Send a zap",
  eventId,
  aTag,
  episodeGuid,
  onZapped,
  onClose,
}) {
  const ensureIdentity = useEnsureIdentity();
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
  const [zapId, setZapId] = useState(null);
  const [guestNsec, setGuestNsec] = useState(null);
  const zapDetailsRef = useRef(null); // { amountSats, comment, episodeGuid }
  const identityRef = useRef(null); // set once handleZap runs, reused by publishBoostNote/handleManualConfirm
  const pollRef = useRef(null);

  const effectiveAmount = customAmount ? Number(customAmount) : amount;
  const pathname = usePathname();
  const initialPathnameRef = useRef(pathname);

  useEffect(() => {
    return () => clearInterval(pollRef.current);
  }, []);

  // Close automatically once payment is confirmed — after a few seconds
  // to actually read it, or immediately if they navigate elsewhere
  // (including same-page hash links, which don't unmount this component
  // on their own).
  useEffect(() => {
    if (status !== "paid") return;
    const timer = setTimeout(() => onClose?.(), 6000);
    return () => clearTimeout(timer);
  }, [status, onClose]);

  useEffect(() => {
    if (pathname !== initialPathnameRef.current) {
      onClose?.();
    }
  }, [pathname, onClose]);

  // Publishes a real Nostr note, signed by the ZAPPER (not the show),
  // announcing that they boosted — following the same convention Fountain
  // and BoostMeBitch use. This is what makes a boost sent through our
  // site visible on indexers like OnlyBoosts, and gives the person their
  // own public record of it, same as boosting anywhere else on Nostr.
  // Best-effort: only fires after payment is actually confirmed, never
  // blocks the "paid" UI state if it fails.
  async function publishBoostNote() {
    const details = zapDetailsRef.current;
    const identity = identityRef.current;
    if (!details || !identity) return;
    try {
      const tags = details.episodeGuid ? episodeTags(details.episodeGuid) : showTags();
      const template = {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: [...tags, ["amount", String(details.amountSats * 1000)], ["t", "boostagram"]],
        content: details.comment || `⚡ Boosted ${details.amountSats.toLocaleString()} sats`,
      };
      const signed = await identity.signEvent(template);
      await Promise.any(getPublishPool().publish(DEFAULT_RELAYS, signed));
    } catch {
      // best-effort — not publishing this doesn't undo the real payment
    }
  }

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
          publishBoostNote();
        }
      } catch {
        // network hiccup — just try again next tick
      }
    }, POLL_INTERVAL_MS);
  }

  async function handleZap() {
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
      const identity = await ensureIdentity();
      identityRef.current = identity;
      if (identity.isGuest) setGuestNsec(identity.nsec);

      const lnurlData = await resolveLud16(profile.lud16);
      const amountMsats = effectiveAmount * 1000;

      const template = buildZapRequestTemplate({
        recipientPubkey,
        amountMsats,
        relays: DEFAULT_RELAYS,
        comment,
        eventId,
        aTag,
        extraTags: episodeGuid ? episodeTags(episodeGuid) : showTags(),
      });

      const signed = await identity.signEvent(template);

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
          pubkey: identity.pubkey,
          sellerPubkey: recipientPubkey,
          invoice: pr,
          verifyUrl: verify,
          amountSats: effectiveAmount,
          episodeGuid: episodeGuid || null,
          comment,
        }),
      }).catch(() => {});

      const qr = await QRCode.toDataURL(pr.toUpperCase(), { margin: 1, width: 320 });

      setInvoice(pr);
      setQrDataUrl(qr);
      setZapId(`${signed.id}`);
      zapDetailsRef.current = { amountSats: effectiveAmount, comment, episodeGuid };
      setStatus("ready");
      startPolling(verify);
      onZapped?.();
    } catch (e) {
      setError(e.message || "Something went wrong generating the invoice.");
      setStatus("error");
    }
  }

  async function handleManualConfirm() {
    clearInterval(pollRef.current);
    setStatus("paid");
    onZapped?.();
    publishBoostNote();
    fetch("/api/confirm-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: zapId }),
    }).catch(() => {});
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

              <p className="text-center text-xs text-ink/50">
                No Nostr account needed &mdash; zapping creates a one-time
                identity just for it, automatically.{" "}
                <button
                  onClick={() => setShowLogin(true)}
                  className="text-jade underline hover:text-ink"
                >
                  Already have one? Log in instead
                </button>
              </p>
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
                  &mdash; once you&rsquo;ve paid, tap the button below.
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
              {!canAutoDetect && (
                <button
                  onClick={handleManualConfirm}
                  className="w-full border-2 border-ink bg-ink px-4 py-3 font-display text-sm tracking-widest text-paper hover:bg-jade hover:border-jade"
                >
                  I&rsquo;VE PAID
                </button>
              )}
            </div>
          )}

          {status === "paid" && (
            <div className="space-y-3 text-center font-serif text-ink/80">
              <p className="text-4xl">⚡✓</p>
              <p className="font-display text-xl text-jade">
                PAYMENT RECEIVED
              </p>
              <p>Thanks for the boost!</p>

              {guestNsec && (
                <div className="border-2 border-ink/10 bg-ink/5 p-3 text-left text-xs">
                  <p className="font-display tracking-widest text-ink/60">
                    ABOUT YOUR ZAP IDENTITY
                  </p>
                  <p className="mt-1 text-ink/70">
                    We created a one-time Nostr key just for this zap, so
                    you didn&rsquo;t need an account. Nothing to do here
                    &mdash; but if you&rsquo;d ever like to see this boost
                    under your own name elsewhere on Nostr, this key can
                    be imported into any Nostr app:
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
