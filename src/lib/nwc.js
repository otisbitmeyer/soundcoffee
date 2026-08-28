// NIP-47 (Nostr Wallet Connect) — lets a buyer connect their own
// Lightning wallet directly to checkout, so paying is "click, approve
// in your wallet" instead of copying an invoice into a separate app.
//
// The "secret" in a connection URI is a real (but scoped/revocable)
// private key the wallet issued specifically for this connection — not
// the buyer's main Nostr identity. We use it only to sign/encrypt
// requests to that one wallet, and only for the current checkout unless
// the person explicitly chooses to save it for next time.

import { getPublicKey, finalizeEvent } from "nostr-tools/pure";
import { encrypt as nip04Encrypt, decrypt as nip04Decrypt } from "nostr-tools/nip04";
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
 * Pays a Lightning invoice through a connected wallet via NIP-47.
 * Resolves with { preimage } on success, throws on failure or timeout.
 */
export async function payInvoiceViaNwc(nwcUri, invoice, { timeoutMs = 30000 } = {}) {
  const { walletPubkey, relays, secret } = parseNwcUri(nwcUri);
  const clientSecretKey = hexToBytes(secret);
  const clientPubkey = getPublicKey(clientSecretKey);

  const requestContent = JSON.stringify({ method: "pay_invoice", params: { invoice } });
  const encryptedContent = await nip04Encrypt(clientSecretKey, walletPubkey, requestContent);

  const requestTemplate = {
    kind: 23194,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["p", walletPubkey]],
    content: encryptedContent,
  };
  const signedRequest = finalizeEvent(requestTemplate, clientSecretKey);

  const pool = getPool();

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
      [{ kinds: [23195], "#e": [signedRequest.id], "#p": [clientPubkey] }],
      {
        onevent: async (event) => {
          if (settled) return;
          try {
            const decrypted = await nip04Decrypt(clientSecretKey, walletPubkey, event.content);
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
