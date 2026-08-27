"use client";

import { finalizeEvent } from "nostr-tools/pure";
import { getConversationKey, encrypt as nip44EncryptRaw } from "nostr-tools/nip44";
import { useAuth } from "@/context/AuthContext";

/**
 * Returns an `ensureIdentity()` function — call it right before signing
 * anything. If the person is already logged in, it just returns the
 * context's own signEvent/nip44Encrypt. If not, it silently generates a
 * fresh one-time identity (no login prompt, no setup) and returns
 * functions that sign directly against that fresh key.
 *
 * Signing/encrypting for a brand-new guest identity is done directly
 * against the just-generated secret key rather than through the
 * context's own signEvent/nip44Encrypt — React state updates aren't
 * visible synchronously, so those functions wouldn't see the new key
 * until after a re-render, which is too late for the rest of the same
 * call (e.g. building and sending a zap request immediately after).
 */
export function useEnsureIdentity() {
  const { isLoggedIn, pubkey, signEvent, nip44Encrypt, createGuestKeys } = useAuth();

  async function ensureIdentity() {
    if (isLoggedIn) {
      return { pubkey, signEvent, nip44Encrypt, isGuest: false };
    }
    const guest = createGuestKeys();
    return {
      pubkey: guest.pubkey,
      nsec: guest.nsec,
      isGuest: true,
      signEvent: async (template) => finalizeEvent(template, guest.secretKey),
      nip44Encrypt: async (recipientPubkey, plaintext) => {
        const conversationKey = getConversationKey(guest.secretKey, recipientPubkey);
        return nip44EncryptRaw(plaintext, conversationKey);
      },
    };
  }

  return ensureIdentity;
}
