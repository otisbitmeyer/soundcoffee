// NIP-57 (Lightning Zaps) helpers.

/**
 * Resolves a lud16 Lightning address ("name@domain.com") to its LNURL-pay
 * parameters by fetching the well-known endpoint the address implies.
 */
export async function resolveLud16(lud16) {
  const [name, domain] = lud16.split("@");
  if (!name || !domain) throw new Error("Invalid Lightning address.");
  const res = await fetch(`https://${domain}/.well-known/lnurlp/${name}`);
  if (!res.ok) throw new Error("Couldn't reach that Lightning address.");
  const data = await res.json();
  if (!data.callback) throw new Error("That Lightning address isn't set up for payments.");
  return data; // { callback, minSendable, maxSendable, allowsNostr, nostrPubkey, ... }
}

/**
 * Builds an unsigned NIP-57 zap request (kind 9734) event template.
 * `target` can include an eventId and/or an "a" coordinate (for addressable
 * events like NIP-99 listings) to tie the zap to a specific thing.
 */
export function buildZapRequestTemplate({
  recipientPubkey,
  amountMsats,
  relays,
  comment = "",
  eventId,
  aTag,
}) {
  const tags = [
    ["relays", ...relays],
    ["amount", String(amountMsats)],
    ["p", recipientPubkey],
  ];
  if (eventId) tags.push(["e", eventId]);
  if (aTag) tags.push(["a", aTag]);

  return {
    kind: 9734,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: comment,
  };
}

/**
 * Takes a signed zap request event and requests the actual Lightning
 * invoice from the recipient's LNURL callback.
 */
export async function requestZapInvoice({ callback, amountMsats, signedZapRequest, lnurl }) {
  const params = new URLSearchParams({
    amount: String(amountMsats),
    nostr: JSON.stringify(signedZapRequest),
  });
  if (lnurl) params.set("lnurl", lnurl);

  const res = await fetch(`${callback}?${params.toString()}`);
  const data = await res.json();
  if (!data.pr) {
    throw new Error(data.reason || "Couldn't generate an invoice.");
  }
  return data.pr; // bolt11 invoice string
}
