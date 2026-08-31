// NIP-47 (Nostr Wallet Connect) — lets a buyer connect their own
// Lightning wallet directly to checkout, so paying is "click, approve
// in your wallet" instead of copying an invoice into a separate app.
//
// The "secret" in a connection URI is a real (but scoped/revocable)
// private key the wallet issued specifically for this connection — not
// the buyer's main Nostr identity. We use it only to sign/encrypt
// requests to that one wallet, and only for the current checkout unless
// the person explicitly chooses to save it for next time.
//
// Encryption: NIP-04 was the original scheme NWC used, but per the
// current spec it's now deprecated in favor of NIP-44 — a wallet may
// not support NIP-04 at all anymore. The wallet advertises what it
// supports via an "encryption" tag on its own info event (kind 13194);
// we check that first and use NIP-44 whenever it's offered, only
// falling back to NIP-04 for wallets that haven't migrated.

import { getPublicKey, finalizeEvent } from "nostr-tools/pure";
import { encrypt as nip04Encrypt, decrypt as nip04Decrypt } from "nostr-tools/nip04";
import { getConversationKey, encrypt as nip44EncryptRaw, decrypt as nip44DecryptRaw } from "nostr-tools/nip44";
import { hexToBytes } from "nostr-tools/utils";
import { SimplePool } from "nostr-tools/pool";

export function parseNwcUri(uri) {
  if (!uri || !uri.startsWith("nostr+walletconnect://")) {
    throw new Error("That doesn't look like a Nostr Wallet Connect URI — it should start with nostr+walletconnect://");
  }
  const withoutScheme = uri.replace("nostr+walletconnect://", "");
  const [walletPubkey, queryString] = withoutScheme.split("?");
  const params = new URLSearchParams(queryString);
  const relays = params.getAll("relay");
  const secret = params.get("secret");

  if (!walletPubkey || walletPubkey.length !== 64) {
    throw new Error("That connection string is missing a valid wallet pubkey.");
  }
  if (relays.length === 0) {
    throw new Error("That connection string is missing a relay.");
  }
  if (!secret) {
    throw new Error("That connection string is missing its secret.");
  }

  return { walletPubkey, relays, secret };
}

let nwcPool;
function getPool() {
  if (!nwcPool) nwcPool = new SimplePool();
  return nwcPool;
}

/**
 * Checks the wallet's own info event (kind 13194) for which encryption
 * schemes it supports, and picks the best one. Defaults to nip04 if we
 * can't find an info event at all — that's what the spec says the
 * absence of the tag implies. Time-boxed short and separately from the
 * main payment timeout — this shouldn't be able to eat into the budget
 * for the actual payment request/response.
 */
async function negotiateEncryption(pool, relays, walletPubkey) {
  try {
    const infoEvent = await Promise.race([
      pool.get(relays, { kinds: [13194], authors: [walletPubkey] }),
      new Promise((resolve) => setTimeout(() => resolve(null), 5000)),
    ]);
    const encryptionTag = infoEvent?.tags?.find((t) => t[0] === "encryption");
    const supported = encryptionTag?.[1]?.split(" ") || [];
    return supported.includes("nip44_v2") ? "nip44_v2" : "nip04";
  } catch {
    return "nip04";
  }
}

function encryptFor(scheme, secretKey, pubkey, plaintext) {
  if (scheme === "nip44_v2") {
    const conversationKey = getConversationKey(secretKey, pubkey);
    return nip44EncryptRaw(plaintext, conversationKey);
  }
  return nip04Encrypt(secretKey, pubkey, plaintext);
}

function decryptFor(scheme, secretKey, pubkey, ciphertext) {
  if (scheme === "nip44_v2") {
    const conversationKey = getConversationKey(secretKey, pubkey);
    return nip44DecryptRaw(ciphertext, conversationKey);
  }
  return nip04Decrypt(secretKey, pubkey, ciphertext);
}

/**
 * Pays a Lightning invoice through a connected wallet via NIP-47.
 * Resolves with { preimage } on success, throws on failure or timeout.
 */
export async function payInvoiceViaNwc(nwcUri, invoice, { timeoutMs = 30000 } = {}) {
  const { walletPubkey, relays, secret } = parseNwcUri(nwcUri);
  const clientSecretKey = hexToBytes(secret);
  const clientPubkey = getPublicKey(clientSecretKey);

  const pool = getPool();
  const scheme = await negotiateEncryption(pool, relays, walletPubkey);

  const requestContent = JSON.stringify({ method: "pay_invoice", params: { invoice } });
  const encryptedContent = await encryptFor(scheme, clientSecretKey, walletPubkey, requestContent);

  const requestTemplate = {
    kind: 23194,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["p", walletPubkey],
      ["encryption", scheme],
    ],
    content: encryptedContent,
  };
  const signedRequest = finalizeEvent(requestTemplate, clientSecretKey);

  return new Promise((resolve, reject) => {
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      sub.close();
      reject(new Error("Your wallet didn't respond in time. Check that it's online and try again."));
    }, timeoutMs);

    const sub = pool.subscribeMany(
      relays,
      // Matching on kind + recipient alone, not also requiring the e
      // tag — the spec says a response "SHOULD" include one, not
      // "MUST", so a wallet that omits it would otherwise be
      // invisible to us entirely. Successful decryption below is what
      // actually confirms this is the real response, not the tag
      // match itself.
      [{ kinds: [23195], "#p": [clientPubkey] }],
      {
        onevent: async (event) => {
          if (settled) return;
          try {
            const decrypted = await decryptFor(scheme, clientSecretKey, walletPubkey, event.content);
            const response = JSON.parse(decrypted);
            settled = true;
            clearTimeout(timeout);
            sub.close();
            if (response.error) {
              reject(new Error(response.error.message || "Your wallet declined the payment."));
            } else {
              resolve(response.result);
            }
          } catch {
            // Malformed or unrelated response — keep waiting for the
            // real one rather than failing on the first stray event.
          }
        },
      }
    );

    Promise.any(pool.publish(relays, signedRequest)).catch(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      sub.close();
      reject(new Error("Couldn't reach your wallet's relay."));
    });
  });
}
