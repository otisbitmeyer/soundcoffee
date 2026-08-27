"use client";

import { useEffect, useState, Fragment } from "react";
import { SimplePool } from "nostr-tools/pool";
import { nip19 } from "nostr-tools";
import Header from "@/components/Header";
import LoginModal from "@/components/LoginModal";
import { useAuth } from "@/context/AuthContext";
import { useProfile } from "@/hooks/useProfile";
import { useNip99Listings } from "@/hooks/useNip99Listings";
import { unwrapGiftWrap, giftWrapForBoth } from "@/lib/nip17";
import { DEFAULT_RELAYS, getDmRelaysFor } from "@/lib/relays";
import { SOUND_COFFEE_PUBKEY } from "@/lib/identities";

// A wider set than the site's usual DEFAULT_RELAYS — this search needs to
// cast a much broader net, since an order could arrive from any app,
// published to relays we'd have no other reason to know about.
const EXTRA_SEARCH_RELAYS = [
  "wss://relay.snort.social",
  "wss://nostr.wine",
  "wss://relay.nostr.bg",
  "wss://offchain.pub",
  "wss://relay.mostr.pub",
  "wss://relay.nostrplebs.com",
  "wss://relay.conduit.market",
];

let publishPool;
function getPublishPool() {
  if (!publishPool) publishPool = new SimplePool();
  return publishPool;
}

function getTag(event, name) {
  return event.tags.find((t) => t[0] === name);
}

function parseOrder(rumor) {
  if (rumor.kind !== 16 && rumor.kind !== 4) return null;
  const typeTag = getTag(rumor, "type");
  if (typeTag?.[1] !== "1") return null;

  return {
    orderId: getTag(rumor, "order")?.[1],
    buyerPubkey: rumor.pubkey,
    amountSats: Number(getTag(rumor, "amount")?.[1] || 0),
    items: rumor.tags.filter((t) => t[0] === "item").map((t) => ({
      coordinate: t[1],
      quantity: t[2] || "1",
    })),
    address: getTag(rumor, "address")?.[1] || null,
    email: getTag(rumor, "email")?.[1] || null,
    phone: getTag(rumor, "phone")?.[1] || null,
    notes: rumor.content || "",
    createdAt: rumor.created_at,
  };
}

function parseReceipt(rumor) {
  if (rumor.kind !== 17) return null;
  return { orderId: getTag(rumor, "order")?.[1], createdAt: rumor.created_at };
}

/** General communication (kind 14, or kind 4 for NIP-04 apps) tied to an order via its subject tag. */
function parseMessage(rumor) {
  if (rumor.kind !== 14 && rumor.kind !== 4) return null;
  const orderId = getTag(rumor, "subject")?.[1];
  if (!orderId) return null;
  return {
    orderId,
    fromMe: rumor.pubkey === SOUND_COFFEE_PUBKEY,
    senderPubkey: rumor.pubkey,
    content: rumor.content,
    createdAt: rumor.created_at,
  };
}

function BuyerName({ pubkey }) {
  const { profile } = useProfile(pubkey || undefined);
  if (!pubkey) {
    return <div className="font-serif text-xs italic text-ink/50">No account</div>;
  }
  const npub = nip19.npubEncode(pubkey);
  const name = profile?.display_name || profile?.name;
  return (
    <div>
      {name && <div className="font-display text-sm text-ink">{name}</div>}
      <div className="font-mono text-xs text-ink/50">
        {npub.slice(0, 12)}…{npub.slice(-6)}
      </div>
    </div>
  );
}

function ItemNames({ items, listings }) {
  return (
    <div className="space-y-0.5">
      {items.map((item, i) => {
        const listing = listings?.find((l) => l.coordinate === item.coordinate);
        return (
          <div key={i} className="text-sm">
            {listing?.title || item.coordinate.split(":").pop()}{" "}
            <span className="text-ink/50">&times;{item.quantity}</span>
          </div>
        );
      })}
    </div>
  );
}

function OrderDetail({ order, messages, onSend, onMarkShipped }) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [tracking, setTracking] = useState(order.trackingNumber || "");
  const [carrier, setCarrier] = useState(order.carrier || "");
  const [shipping, setShipping] = useState(false);
  const { profile: buyerProfile } = useProfile(order.buyerPubkey);

  async function handleSend() {
    if (!draft.trim()) return;
    setSending(true);
    try {
      await onSend(order, draft.trim());
      setDraft("");
    } finally {
      setSending(false);
    }
  }

  async function handleMarkShipped() {
    setShipping(true);
    try {
      await onMarkShipped(order, { trackingNumber: tracking.trim(), carrier: carrier.trim() });
    } finally {
      setShipping(false);
    }
  }

  return (
    <tr>
      <td colSpan={10} className="bg-ink/5 px-4 py-4">
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="font-serif text-sm text-ink/80">
            <p className="font-display text-xs tracking-widest text-ink/50">
              FULL SHIPPING ADDRESS
            </p>
            <p className="mt-1 whitespace-pre-line">{order.address || "Not provided"}</p>
            <p className="mt-3 font-display text-xs tracking-widest text-ink/50">
              CONTACT
            </p>
            <p className="mt-1">{order.email || "No email provided"}</p>
            {order.phone && <p>{order.phone}</p>}
            {order.notes && (
              <>
                <p className="mt-3 font-display text-xs tracking-widest text-ink/50">
                  ORDER NOTES
                </p>
                <p className="mt-1">{order.notes}</p>
              </>
            )}

            {order.fromD1 && (
              <div className="mt-4 border-t border-ink/10 pt-3">
                <p className="font-display text-xs tracking-widest text-ink/50">
                  FULFILLMENT
                </p>
                {order.fulfillmentStatus === "shipped" ? (
                  <p className="mt-1 text-jade">
                    📦 Shipped
                    {order.trackingNumber ? ` — ${order.trackingNumber}` : ""}
                    {order.carrier ? ` (${order.carrier})` : ""}
                  </p>
                ) : (
                  <div className="mt-2 space-y-2">
                    <div className="flex gap-2">
                      <input
                        value={tracking}
                        onChange={(e) => setTracking(e.target.value)}
                        placeholder="Tracking number (optional)"
                        className="flex-1 border-2 border-ink/30 px-2 py-1.5 text-xs focus:border-ink focus:outline-none"
                      />
                      <input
                        value={carrier}
                        onChange={(e) => setCarrier(e.target.value)}
                        placeholder="Carrier (optional)"
                        className="w-28 border-2 border-ink/30 px-2 py-1.5 text-xs focus:border-ink focus:outline-none"
                      />
                    </div>
                    <button
                      onClick={handleMarkShipped}
                      disabled={shipping}
                      className="w-full border-2 border-ink bg-ink px-3 py-2 font-display text-xs tracking-widest text-paper hover:bg-jade hover:border-jade disabled:opacity-50"
                    >
                      {shipping ? "MARKING SHIPPED…" : "📦 MARK SHIPPED & NOTIFY"}
                    </button>
                    <p className="text-[11px] italic text-ink/40">
                      Notifies by Nostr DM if they were signed in, and by
                      email if they left an address. Neither, if
                      neither applies — nothing to send it to.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <p className="font-display text-xs tracking-widest text-ink/50">
              MESSAGE {buyerProfile?.display_name || buyerProfile?.name || "BUYER"}
            </p>

            {order.isGuest && !order.email ? (
              <div className="mt-2 border-2 border-ink/10 bg-paper p-3 font-serif text-xs italic text-ink/50">
                This order was placed anonymously with no email address —
                there&rsquo;s no reliable way to reach this buyer. A Nostr
                DM would go to a one-time key they likely never saved.
              </div>
            ) : (
              <>
                <div className="mt-2 max-h-48 space-y-2 overflow-y-auto border-2 border-ink/10 bg-paper p-3">
                  {messages.length === 0 && (
                    <p className="font-serif text-xs italic text-ink/40">
                      No messages yet.
                    </p>
                  )}
                  {messages.map((m, i) => (
                    <div
                      key={i}
                      className={`font-serif text-sm ${m.fromMe ? "text-right" : "text-left"}`}
                    >
                      <span
                        className={`inline-block max-w-[85%] px-3 py-1.5 ${
                          m.fromMe ? "bg-ink text-paper" : "border border-ink/20 text-ink"
                        }`}
                      >
                        {m.content}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex gap-2">
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSend()}
                    placeholder="Ask about their order…"
                    className="flex-1 border-2 border-ink/30 px-3 py-2 font-serif text-sm focus:border-ink focus:outline-none"
                  />
                  <button
                    onClick={handleSend}
                    disabled={sending || !draft.trim()}
                    className="border-2 border-ink bg-ink px-4 py-2 font-display text-xs tracking-widest text-paper hover:bg-rust hover:border-rust disabled:opacity-50"
                  >
                    {sending ? "…" : "SEND"}
                  </button>
                </div>
              </>
            )}

            {order.email && (
              <a
                href={`mailto:${order.email}?subject=${encodeURIComponent(
                  `Your Sound Coffee order`
                )}`}
                className="mt-2 inline-block font-display text-xs tracking-widest text-jade hover:text-ink"
              >
                ✉️ EMAIL {order.email}
              </a>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}

export default function OrdersPage() {
  const { isLoggedIn, pubkey, signEvent, nip44Encrypt, nip44Decrypt, nip04Decrypt, restoring } = useAuth();
  const [showLogin, setShowLogin] = useState(false);
  const [orders, setOrders] = useState(null);
  const [paidOrderIds, setPaidOrderIds] = useState(new Set());
  const [messagesByOrder, setMessagesByOrder] = useState({});
  const [expandedOrderId, setExpandedOrderId] = useState(null);
  const [loadProgress, setLoadProgress] = useState(null);
  const [relaysSearched, setRelaysSearched] = useState([]);
  const [diagnostics, setDiagnostics] = useState(null);
  const [error, setError] = useState(null);
  const [showAllOrders, setShowAllOrders] = useState(false); // default: paid-only
  const [dismissedIds, setDismissedIds] = useState(new Set());

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("dismissed-orders") || "[]");
      setDismissedIds(new Set(saved));
    } catch {
      // ignore
    }
  }, []);

  function dismissOrder(orderId) {
    setDismissedIds((prev) => {
      const next = new Set(prev);
      next.add(orderId);
      localStorage.setItem("dismissed-orders", JSON.stringify([...next]));
      return next;
    });
  }

  const isRightAccount = pubkey === SOUND_COFFEE_PUBKEY;
  const { allListings } = useNip99Listings(SOUND_COFFEE_PUBKEY);

  useEffect(() => {
    if (!isRightAccount) return;
    let cancelled = false;

    async function load() {
      try {
        // D1 is now the authoritative source for orders placed through
        // this site — real primary-key uniqueness, no risk of the same
        // order showing up twice the way relay-scanned DMs sometimes did.
        const d1Res = await fetch("/api/orders");
        const d1Data = await d1Res.json();
        if (!d1Res.ok) {
          throw new Error(d1Data.error || `Server returned ${d1Res.status}`);
        }
        const d1Orders = d1Data.orders || [];
        const d1OrderIds = new Set(d1Orders.map((o) => o.id));

        const d1AsOrders = d1Orders.map((o) => ({
          orderId: o.id,
          buyerPubkey: o.customer_pubkey,
          amountSats: o.amount_sats || 0,
          amountUsdCents: o.amount_usd_cents || null,
          isGuest: !!o.is_guest,
          items: o.items,
          address: [o.address_line1, o.address_line2, [o.city, o.state, o.zip].filter(Boolean).join(", "), o.country].filter(Boolean).join("\n") || null,
          email: o.customer_email,
          phone: o.phone,
          notes: o.notes,
          createdAt: Math.floor(o.created_at / 1000),
          paymentMethod: o.payment_method,
          paidD1: o.payment_status === "paid",
          fulfillmentStatus: o.fulfillment_status || "unfulfilled",
          trackingNumber: o.tracking_number,
          carrier: o.carrier,
          fromD1: true,
        }));

        const ownDmRelays = await getDmRelaysFor(SOUND_COFFEE_PUBKEY);

        // The same dynamically-refreshed pool of currently-active relays
        // the backend uses for zap detection — previously this page only
        // ever searched a small hand-maintained list, meaning an order
        // published anywhere outside it would never be found regardless
        // of which specific relays we'd individually added.
        let dynamicRelays = [];
        try {
          const relaysRes = await fetch("/api/relays");
          const relaysData = await relaysRes.json();
          dynamicRelays = relaysData.relays || [];
        } catch {
          // Falls back to the static list below — never a hard failure.
        }

        const searchRelays = [
          ...new Set([...ownDmRelays, ...DEFAULT_RELAYS, ...EXTRA_SEARCH_RELAYS, ...dynamicRelays]),
        ];
        setRelaysSearched(searchRelays);

        const pool = new SimplePool();
        const events = await pool.querySync(searchRelays, {
          kinds: [1059, 4],
          "#p": [SOUND_COFFEE_PUBKEY],
        });
        pool.close(searchRelays);

        if (cancelled) return;
        setLoadProgress({ done: 0, total: events.length });

        // Only orders NOT already in D1 — i.e. genuinely from other
        // marketplace apps, not our own checkout (which is already
        // represented via d1AsOrders above).
        const foundOrders = [...d1AsOrders];
        const foundPaidIds = new Set(
          d1Orders.filter((o) => o.payment_status === "paid").map((o) => o.id)
        );
        const foundMessages = {};

        // Real diagnostics instead of silently swallowing every failure —
        // this is what tells us WHERE something breaks (never retrieved
        // vs. retrieved-but-undecryptable vs. decrypted-but-irrelevant)
        // instead of just "nothing showed up."
        const diag = {
          totalEventsFound: events.length,
          kind1059Count: events.filter((e) => e.kind === 1059).length,
          kind4Count: events.filter((e) => e.kind === 4).length,
          decryptFailures: 0,
          decryptedNotOrderRelated: 0,
          unrecognizedSamples: [],
          firstError: null,
        };

        for (let i = 0; i < events.length; i++) {
          const event = events[i];
          try {
            let rumor;
            if (event.kind === 1059) {
              // NIP-17 — double-encrypted, tags live inside the sealed
              // rumor, not on the outer event.
              rumor = await unwrapGiftWrap(event, nip44Decrypt);
            } else {
              // NIP-04 (kind 4) — the older format some apps (Conduit,
              // it turns out) still use. Tags are NOT encrypted here,
              // only content is — so the event itself already has
              // everything needed except the notes field.
              let content = "";
              try {
                content = await nip04Decrypt(event.pubkey, event.content);
              } catch {
                // Notes just won't be visible — the rest of the order
                // (tags) is still fully readable regardless.
              }
              rumor = { ...event, content };
            }

            const order = parseOrder(rumor);
            const receipt = parseReceipt(rumor);
            const message = parseMessage(rumor);
            if (!order && !receipt && !message) {
              diag.decryptedNotOrderRelated++;
              // Capture a few real samples — this is what actually shows
              // us whether Conduit's tag structure differs from what our
              // parser expects, instead of continuing to guess blind.
              if (diag.unrecognizedSamples.length < 5) {
                diag.unrecognizedSamples.push({
                  kind: rumor.kind,
                  tags: rumor.tags,
                  contentPreview: (rumor.content || "").slice(0, 80),
                });
              }
            }

            if (order && !d1OrderIds.has(order.orderId)) foundOrders.push(order);
            if (receipt?.orderId) foundPaidIds.add(receipt.orderId);
            if (message) {
              if (!foundMessages[message.orderId]) foundMessages[message.orderId] = [];
              foundMessages[message.orderId].push(message);
            }
          } catch (e) {
            diag.decryptFailures++;
            if (!diag.firstError) {
              diag.firstError = `${e.message || e} (kind ${event.kind})`;
              // None of this requires decryption — it's exactly what's
              // safe to inspect about a message we can't read the
              // contents of, and it's enough to actually diagnose why.
              diag.firstFailureDetail = {
                pubkey: event.pubkey,
                contentLength: event.content?.length ?? 0,
                contentPreview: (event.content || "").slice(0, 40),
                tagCount: event.tags?.length ?? 0,
                createdAt: new Date(event.created_at * 1000).toISOString(),
                id: event.id,
                sealPubkey: e.sealPubkey,
                sealPubkeyType: e.sealPubkeyType,
                sealPubkeyLength: e.sealPubkeyLength,
                sealContentLength: e.sealContentLength,
                sealKind: e.sealKind,
              };
            }
          }
          if (!cancelled) setLoadProgress({ done: i + 1, total: events.length });
        }

        if (!cancelled) setDiagnostics(diag);

        if (cancelled) return;
        foundOrders.sort((a, b) => b.createdAt - a.createdAt);

        // Flag (never hide) likely duplicates — same buyer, same items,
        // same amount, placed within a couple minutes of each other. Most
        // often caused by a double-click before the button disabled
        // itself. Left for you to judge, not silently removed.
        const itemsKey = (o) => o.items.map((i) => `${i.coordinate}:${i.quantity}`).join("|");
        for (let i = 0; i < foundOrders.length; i++) {
          const a = foundOrders[i];
          a.possibleDuplicate = foundOrders.some((b, j) => {
            if (j === i) return false;
            return (
              b.buyerPubkey === a.buyerPubkey &&
              b.amountSats === a.amountSats &&
              itemsKey(b) === itemsKey(a) &&
              Math.abs(b.createdAt - a.createdAt) < 120
            );
          });
        }

        for (const id in foundMessages) {
          foundMessages[id].sort((a, b) => a.createdAt - b.createdAt);
        }
        setOrders(foundOrders);
        setPaidOrderIds(foundPaidIds);
        setMessagesByOrder(foundMessages);
      } catch (e) {
        if (!cancelled) setError(e.message || "Unknown error");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [isRightAccount, nip44Decrypt, nip04Decrypt]);

  async function handleSendMessage(order, text) {
    const eventTemplate = {
      kind: 14,
      tags: [["p", order.buyerPubkey], ["subject", order.orderId]],
      content: text,
    };
    const [toBuyer, toSelf] = await giftWrapForBoth({
      eventTemplate,
      senderPubkey: pubkey,
      recipientPubkey: order.buyerPubkey,
      authNip44Encrypt: nip44Encrypt,
      authSignEvent: signEvent,
    });

    const buyerDmRelays = await getDmRelaysFor(order.buyerPubkey);
    const publishTargets = [...new Set([...buyerDmRelays, ...DEFAULT_RELAYS])];

    await Promise.any(getPublishPool().publish(publishTargets, toBuyer));
    await Promise.any(getPublishPool().publish(DEFAULT_RELAYS, toSelf));

    setMessagesByOrder((prev) => ({
      ...prev,
      [order.orderId]: [
        ...(prev[order.orderId] || []),
        {
          orderId: order.orderId,
          fromMe: true,
          senderPubkey: pubkey,
          content: text,
          createdAt: Math.floor(Date.now() / 1000),
        },
      ],
    }));
  }

  async function handleMarkShipped(order, { trackingNumber, carrier }) {
    // Update D1 first — this is the record of truth, and should succeed
    // even if the notification step below has trouble.
    await fetch("/api/orders/ship", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: order.orderId, trackingNumber, carrier }),
    });

    const trackingLine = trackingNumber
      ? `\n\nTracking: ${trackingNumber}${carrier ? ` (${carrier})` : ""}`
      : "";
    const messageText = `📦 Your order has shipped!${trackingLine}`;

    // Nostr DM — only meaningful if they have a real (or at least
    // reachable) identity, same rule as regular order messaging.
    const canMessageViaNostr = !(order.isGuest && !order.email);
    if (canMessageViaNostr && order.buyerPubkey) {
      try {
        await handleSendMessage(order, messageText);
      } catch {
        // best-effort — D1 update above already succeeded either way
      }
    }

    // Email — independent of the Nostr path, sent if they left an address.
    if (order.email) {
      fetch("/api/notify-shipped", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: order.orderId,
          buyerEmail: order.email,
          itemTitle: order.items?.[0]?.title,
          trackingNumber,
          carrier,
        }),
      }).catch(() => {});
    }

    // Reflect the change immediately without needing a full reload.
    setOrders((prev) =>
      prev.map((o) =>
        o.orderId === order.orderId
          ? { ...o, fulfillmentStatus: "shipped", trackingNumber, carrier }
          : o
      )
    );
  }

  return (
    <>
      <Header />

      <main className="admin-fonts flex-1 bg-paper">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <h1 className="text-center font-display text-4xl tracking-wide text-ink">
            ORDERS
          </h1>
          <p className="mt-3 text-center font-serif text-ink/70">
            Every NIP-99 order sent to the Sound Coffee npub, decrypted
            here directly — however it arrived. Click a row for full
            shipping details and to message the buyer directly.
          </p>

          {!restoring && !isLoggedIn && (
            <div className="mx-auto mt-10 max-w-sm border-2 border-ink p-6 text-center">
              <p className="font-serif text-ink/80">
                Log in as the Sound Coffee account to view orders.
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
            <p className="mx-auto mt-10 max-w-sm border-2 border-rust bg-rust/10 p-4 text-center font-serif text-rust">
              You&rsquo;re logged in, but not as the Sound Coffee account.
            </p>
          )}

          {isRightAccount && relaysSearched.length > 0 && (
            <details className="mx-auto mt-6 max-w-2xl border border-ink/20 p-3 text-center font-serif text-xs text-ink/50">
              <summary className="cursor-pointer font-display tracking-widest">
                RELAYS SEARCHED ({relaysSearched.length})
              </summary>
              <p className="mt-2 font-mono">{relaysSearched.join(", ")}</p>
              <p className="mt-2 italic">
                Publish your own DM relay list under Club Admin &rarr;
                Merchant Settings to make sure well-behaved apps send
                orders somewhere we&rsquo;re actually looking.
              </p>
            </details>
          )}

          {isRightAccount && diagnostics && (
            <div className="mx-auto mt-4 max-w-2xl border-2 border-jade/40 bg-jade/5 p-4 text-center font-serif text-xs text-ink/70">
              <p className="font-display tracking-widest text-jade">
                DIAGNOSTIC — LAST SEARCH
              </p>
              <p className="mt-2">
                Found {diagnostics.totalEventsFound} encrypted message
                {diagnostics.totalEventsFound === 1 ? "" : "s"} addressed
                to you ({diagnostics.kind1059Count} NIP-17,{" "}
                {diagnostics.kind4Count} NIP-04).
              </p>
              <p className="mt-1">
                {diagnostics.decryptFailures > 0 ? (
                  <span className="text-rust">
                    {diagnostics.decryptFailures} failed to decrypt.
                  </span>
                ) : (
                  <span className="text-jade">
                    All of them decrypted successfully.
                  </span>
                )}{" "}
                {diagnostics.decryptedNotOrderRelated} decrypted fine but
                weren&rsquo;t order/receipt/message content.
              </p>

              {diagnostics.unrecognizedSamples.length > 0 && (
                <div className="mt-2 border-t border-ink/10 pt-2 text-left font-mono text-[11px] text-ink/60">
                  <p className="font-display tracking-widest text-ink/40">
                    UNRECOGNIZED SAMPLES
                  </p>
                  {diagnostics.unrecognizedSamples.map((s, i) => (
                    <div key={i} className="mt-1 border-t border-ink/5 pt-1">
                      <p>kind: {s.kind}</p>
                      <p>tags: {JSON.stringify(s.tags)}</p>
                      <p>content: {s.contentPreview}…</p>
                    </div>
                  ))}
                </div>
              )}
              {diagnostics.firstError && (
                <div className="mt-2 border-t border-ink/10 pt-2 text-left font-mono text-[11px] text-rust">
                  <p>First error: {diagnostics.firstError}</p>
                  {diagnostics.firstFailureDetail && (
                    <>
                      <p className="mt-1">
                        sender: {diagnostics.firstFailureDetail.pubkey}
                      </p>
                      <p>
                        content length: {diagnostics.firstFailureDetail.contentLength}
                      </p>
                      <p>
                        content starts: {diagnostics.firstFailureDetail.contentPreview}…
                      </p>
                      <p>tags: {diagnostics.firstFailureDetail.tagCount}</p>
                      <p>created_at: {diagnostics.firstFailureDetail.createdAt}</p>
                      <p>event id: {diagnostics.firstFailureDetail.id}</p>
                      <p className="mt-1 border-t border-ink/10 pt-1">
                        seal pubkey: {String(diagnostics.firstFailureDetail.sealPubkey)}
                      </p>
                      <p>
                        seal pubkey type: {diagnostics.firstFailureDetail.sealPubkeyType}{" "}
                        (length: {diagnostics.firstFailureDetail.sealPubkeyLength ?? "n/a"})
                      </p>
                      <p>
                        seal content length: {diagnostics.firstFailureDetail.sealContentLength ?? "n/a"}
                      </p>
                      <p>seal kind: {diagnostics.firstFailureDetail.sealKind ?? "n/a"}</p>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {isRightAccount && error && (
            <div className="mx-auto mt-10 max-w-md border-2 border-rust bg-rust/10 p-4 text-center">
              <p className="font-serif text-rust">Couldn&rsquo;t load orders.</p>
              <p className="mt-1 font-mono text-xs text-rust/70">{error}</p>
            </div>
          )}

          {isRightAccount && !error && orders === null && (
            <p className="mt-10 text-center font-serif italic text-ink/50">
              {loadProgress
                ? `Decrypting messages… ${loadProgress.done}/${loadProgress.total}`
                : "Fetching messages…"}
            </p>
          )}

          {isRightAccount && orders !== null && (
            <div className="mt-10 overflow-x-auto">
              <div className="mb-4 flex items-center justify-between">
                <label className="flex items-center gap-2 font-display text-xs tracking-widest text-ink/60">
                  <input
                    type="checkbox"
                    checked={showAllOrders}
                    onChange={(e) => setShowAllOrders(e.target.checked)}
                  />
                  SHOW UNPAID ORDERS TOO
                </label>
                <span className="font-serif text-xs italic text-ink/40">
                  {orders.filter((o) => paidOrderIds.has(o.orderId)).length} paid
                  {showAllOrders &&
                    ` · ${orders.length - orders.filter((o) => paidOrderIds.has(o.orderId)).length} unpaid hidden by default`}
                </span>
              </div>

              {(() => {
                const visibleOrders = (
                  showAllOrders ? orders : orders.filter((o) => paidOrderIds.has(o.orderId))
                ).filter((o) => !dismissedIds.has(o.orderId));

                if (visibleOrders.length === 0) {
                  return (
                    <p className="text-center font-serif italic text-ink/50">
                      {showAllOrders
                        ? "No orders yet."
                        : "No paid orders yet — check \"show unpaid orders too\" to see orders still awaiting payment."}
                    </p>
                  );
                }

                return (
                <table key={showAllOrders ? "all" : "paid"} className="w-full border-collapse text-left font-serif text-sm">
                  <thead>
                    <tr className="border-b-2 border-ink font-display text-xs tracking-widest text-ink/60">
                      <th className="py-2 pr-4">ORDER #</th>
                      <th className="py-2 pr-4">DATE</th>
                      <th className="py-2 pr-4">BUYER</th>
                      <th className="py-2 pr-4">ITEM(S)</th>
                      <th className="py-2 pr-4">METHOD</th>
                      <th className="py-2 pr-4">AMOUNT</th>
                      <th className="py-2 pr-4">STATUS</th>
                      <th className="py-2 pr-4">SHIPPING</th>
                      <th className="py-2 pr-4">MESSAGES</th>
                      <th className="py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleOrders.map((order) => {
                      const isOpen = expandedOrderId === order.orderId;
                      const msgCount = messagesByOrder[order.orderId]?.length || 0;
                      return (
                        <Fragment key={order.orderId}>
                          <tr
                            onClick={() =>
                              setExpandedOrderId(isOpen ? null : order.orderId)
                            }
                            className="cursor-pointer border-b border-ink/10 align-top hover:bg-ink/5"
                          >
                            <td className="py-3 pr-4 font-mono text-xs text-ink/50">
                              #{order.orderId.replace(/-/g, "").slice(0, 8).toUpperCase()}
                            </td>
                            <td className="py-3 pr-4 text-xs text-ink/50">
                              {new Date(order.createdAt * 1000).toLocaleDateString()}
                              {order.possibleDuplicate && (
                                <div className="mt-1 inline-block border border-rust px-1.5 py-0.5 text-[10px] font-display tracking-widest text-rust">
                                  ⚠ POSSIBLE DUPLICATE
                                </div>
                              )}
                            </td>
                            <td className="py-3 pr-4">
                              <BuyerName pubkey={order.buyerPubkey} />
                            </td>
                            <td className="py-3 pr-4">
                              <ItemNames items={order.items} listings={allListings} />
                            </td>
                            <td className="py-3 pr-4 text-xs">
                              {order.paymentMethod === "card"
                                ? "💳 Card"
                                : order.paymentMethod === "lightning"
                                ? "⚡ Lightning"
                                : "— External"}
                            </td>
                            <td className="py-3 pr-4">
                              {order.paymentMethod === "card" && order.amountUsdCents
                                ? `$${(order.amountUsdCents / 100).toFixed(2)}`
                                : `${order.amountSats.toLocaleString()} sats`}
                            </td>
                            <td className="py-3 pr-4">
                              {paidOrderIds.has(order.orderId) ? (
                                <span className="text-jade">✓ Paid</span>
                              ) : (
                                <span className="text-rust">Awaiting payment</span>
                              )}
                            </td>
                            <td className="py-3 pr-4 text-xs">
                              {order.fulfillmentStatus === "shipped" ? (
                                <span className="text-jade">📦 Shipped</span>
                              ) : order.fromD1 ? (
                                <span className="text-ink/50">Unshipped</span>
                              ) : (
                                <span className="text-ink/30">—</span>
                              )}
                            </td>
                            <td className="py-3 pr-4 text-xs text-ink/50">
                              {msgCount > 0 ? `${msgCount} 💬` : "—"}
                            </td>
                            <td className="py-3 font-display text-xs text-ink/40">
                              <div className="flex items-center gap-2">
                                {!order.fromD1 && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      dismissOrder(order.orderId);
                                    }}
                                    title="Hide this from your view — doesn't delete anything"
                                    className="text-rust hover:text-ink"
                                  >
                                    ✕
                                  </button>
                                )}
                                {isOpen ? "▲" : "▼"}
                              </div>
                            </td>
                          </tr>
                          {isOpen && (
                            <OrderDetail
                              order={order}
                              messages={messagesByOrder[order.orderId] || []}
                              onSend={handleSendMessage}
                              onMarkShipped={handleMarkShipped}
                            />
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
                );
              })()}
            </div>
          )}
        </div>
      </main>

      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
    </>
  );
}
