"use client";

import { useEffect, useState } from "react";
import { SimplePool } from "nostr-tools/pool";
import { nip19 } from "nostr-tools";
import Header from "@/components/Header";
import LoginModal from "@/components/LoginModal";
import { useAuth } from "@/context/AuthContext";
import { useProfile } from "@/hooks/useProfile";
import { useNip99Listings } from "@/hooks/useNip99Listings";
import { unwrapGiftWrap } from "@/lib/nip17";
import { DEFAULT_RELAYS } from "@/lib/relays";
import { SOUND_COFFEE_PUBKEY } from "@/lib/identities";

function getTag(event, name) {
  return event.tags.find((t) => t[0] === name);
}

/**
 * Parses a rumor into an order record, or returns null if it's not an
 * order-creation message (kind 16, type "1") — could be a general
 * message, a payment request from us, a status update, etc.
 */
function parseOrder(rumor) {
  if (rumor.kind !== 16) return null;
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
    notes: rumor.content || "",
    createdAt: rumor.created_at,
  };
}

function parseReceipt(rumor) {
  if (rumor.kind !== 17) return null;
  return {
    orderId: getTag(rumor, "order")?.[1],
    createdAt: rumor.created_at,
  };
}

function BuyerName({ pubkey }) {
  const { profile } = useProfile(pubkey);
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

export default function OrdersPage() {
  const { isLoggedIn, pubkey, nip44Decrypt, restoring } = useAuth();
  const [showLogin, setShowLogin] = useState(false);
  const [orders, setOrders] = useState(null);
  const [paidOrderIds, setPaidOrderIds] = useState(new Set());
  const [loadProgress, setLoadProgress] = useState(null);
  const [error, setError] = useState(false);

  const isRightAccount = pubkey === SOUND_COFFEE_PUBKEY;
  const { allListings } = useNip99Listings(SOUND_COFFEE_PUBKEY);

  useEffect(() => {
    if (!isRightAccount) return;
    let cancelled = false;

    async function load() {
      try {
        const pool = new SimplePool();
        const wraps = await pool.querySync(DEFAULT_RELAYS, {
          kinds: [1059],
          "#p": [SOUND_COFFEE_PUBKEY],
        });
        pool.close(DEFAULT_RELAYS);

        if (cancelled) return;
        setLoadProgress({ done: 0, total: wraps.length });

        const foundOrders = [];
        const foundPaidIds = new Set();

        // Sequential, not parallel — some signers (extensions, remote
        // bunkers) handle one decrypt request at a time much more
        // reliably than a burst of simultaneous ones.
        for (let i = 0; i < wraps.length; i++) {
          try {
            const rumor = await unwrapGiftWrap(wraps[i], nip44Decrypt);
            const order = parseOrder(rumor);
            if (order) foundOrders.push(order);
            const receipt = parseReceipt(rumor);
            if (receipt?.orderId) foundPaidIds.add(receipt.orderId);
          } catch {
            // Not addressed to us in a way we can decrypt, or malformed
            // — skip it, one bad message shouldn't break the dashboard.
          }
          if (!cancelled) setLoadProgress({ done: i + 1, total: wraps.length });
        }

        if (cancelled) return;
        foundOrders.sort((a, b) => b.createdAt - a.createdAt);
        setOrders(foundOrders);
        setPaidOrderIds(foundPaidIds);
      } catch {
        if (!cancelled) setError(true);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [isRightAccount, nip44Decrypt]);

  return (
    <>
      <Header />

      <main className="flex-1 bg-paper">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <h1 className="text-center font-display text-4xl tracking-wide text-ink">
            ORDERS
          </h1>
          <p className="mt-3 text-center font-serif text-ink/70">
            Every NIP-99 order sent to the Sound Coffee npub, decrypted
            here directly — however it arrived. Whether someone bought
            through this site, Conduit, TakeMySats, or any other Gamma-
            compatible marketplace app, it shows up in the same place.
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

          {isRightAccount && error && (
            <p className="mt-10 text-center font-serif italic text-ink/50">
              Couldn&rsquo;t load orders right now &mdash; try again in a
              bit.
            </p>
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
              {orders.length === 0 ? (
                <p className="text-center font-serif italic text-ink/50">
                  No orders yet.
                </p>
              ) : (
                <table className="w-full border-collapse text-left font-serif text-sm">
                  <thead>
                    <tr className="border-b-2 border-ink font-display text-xs tracking-widest text-ink/60">
                      <th className="py-2 pr-4">DATE</th>
                      <th className="py-2 pr-4">BUYER</th>
                      <th className="py-2 pr-4">ITEM(S)</th>
                      <th className="py-2 pr-4">AMOUNT</th>
                      <th className="py-2 pr-4">STATUS</th>
                      <th className="py-2 pr-4">SHIPPING</th>
                      <th className="py-2">NOTES</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((order) => (
                      <tr key={order.orderId} className="border-b border-ink/10 align-top">
                        <td className="py-3 pr-4 text-xs text-ink/50">
                          {new Date(order.createdAt * 1000).toLocaleDateString()}
                        </td>
                        <td className="py-3 pr-4">
                          <BuyerName pubkey={order.buyerPubkey} />
                        </td>
                        <td className="py-3 pr-4">
                          <ItemNames items={order.items} listings={allListings} />
                        </td>
                        <td className="py-3 pr-4">
                          {order.amountSats.toLocaleString()} sats
                        </td>
                        <td className="py-3 pr-4">
                          {paidOrderIds.has(order.orderId) ? (
                            <span className="text-jade">✓ Paid</span>
                          ) : (
                            <span className="text-rust">Awaiting payment</span>
                          )}
                        </td>
                        <td className="py-3 pr-4 max-w-[200px] text-xs">
                          {order.address || "—"}
                          {order.email && (
                            <div className="mt-1 text-ink/50">{order.email}</div>
                          )}
                        </td>
                        <td className="py-3 max-w-[200px] text-xs text-ink/70">
                          {order.notes || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </main>

      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
    </>
  );
}
