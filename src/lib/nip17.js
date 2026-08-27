// NIP-17 (private direct messages) built manually on top of NIP-59 (gift
// wrap), so we can wrap arbitrary custom event kinds (16, 17) rather than
// just plain chat text. Structure per spec: rumor (unsigned inner event)
// -> seal (kind 13, encrypted+signed by the real sender) -> gift wrap
// (kind 1059, encrypted+signed by a random throwaway key so the outer
// event doesn't reveal who sent it).

import { generateSecretKey, finalizeEvent, getEventHash } from "nostr-tools/pure";
import { getConversationKey, encrypt as nip44Encrypt } from "nostr-tools/nip44";

// NIP-59 recommends randomizing timestamps on seals/wraps (up to ~2 days
// in the past) so message timing can't be used to correlate sender/time.
function randomizedPastTimestamp() {
  const now = Math.floor(Date.now() / 1000);
  return now - Math.floor(Math.random() * 60 * 60 * 48);
}

/**
 * Builds one gift-wrapped (kind 1059) event containing `eventTemplate`,
 * addressed to `recipientPubkey`, authored by the logged-in user.
 *
 * `authNip44Encrypt` / `authSignEvent` come from AuthContext, so this
 * works the same whether the user is on an extension or a local key.
 */
export async function giftWrap({
  eventTemplate,
  senderPubkey,
  recipientPubkey,
  authNip44Encrypt,
  authSignEvent,
}) {
  // 1. Rumor: the real (unsigned) event.
  const rumor = {
    ...eventTemplate,
    pubkey: senderPubkey,
    created_at: eventTemplate.created_at ?? Math.floor(Date.now() / 1000),
    tags: eventTemplate.tags ?? [],
    content: eventTemplate.content ?? "",
  };
  rumor.id = getEventHash(rumor);

  // 2. Seal: the rumor, NIP-44 encrypted to the recipient, signed by the
  //    real sender.
  const sealCiphertext = await authNip44Encrypt(recipientPubkey, JSON.stringify(rumor));
  const sealTemplate = {
    kind: 13,
    created_at: randomizedPastTimestamp(),
    tags: [],
    content: sealCiphertext,
  };
  const seal = await authSignEvent(sealTemplate);

  // 3. Wrap: the seal, NIP-44 encrypted to the recipient using a random
  //    one-time key (not the sender's real key) so the outer event can't
  //    be linked back to the sender.
  const randomKey = generateSecretKey();
  const conversationKey = getConversationKey(randomKey, recipientPubkey);
  const wrapCiphertext = nip44Encrypt(JSON.stringify(seal), conversationKey);
  const wrapTemplate = {
    kind: 1059,
    created_at: randomizedPastTimestamp(),
    tags: [["p", recipientPubkey]],
    content: wrapCiphertext,
  };
  return finalizeEvent(wrapTemplate, randomKey);
}

/**
 * Unwraps a gift-wrapped (kind 1059) event back down to the real rumor
 * inside it, using the logged-in user's own decrypt capability (works
 * the same regardless of extension/bunker/local key). This is what
 * makes the order dashboard possible — reading order DMs sent to Sound
 * Coffee, however they got there.
 */
export async function unwrapGiftWrap(wrappedEvent, authNip44Decrypt) {
  const sealJson = await authNip44Decrypt(wrappedEvent.pubkey, wrappedEvent.content);
  if (typeof sealJson !== "string" || !sealJson) {
    throw new Error(
      `Decrypting the wrap returned ${typeof sealJson} instead of text — the signer likely failed to decrypt this specific message and didn't throw a proper error.`
    );
  }
  const seal = JSON.parse(sealJson);
  const rumorJson = await authNip44Decrypt(seal.pubkey, seal.content);
  if (typeof rumorJson !== "string" || !rumorJson) {
    const err = new Error(
      `Decrypting the seal returned ${typeof rumorJson} instead of text — the signer likely failed to decrypt this specific message and didn't throw a proper error.`
    );
    // The wrap itself decrypted fine (we got this far) — so whatever's
    // wrong is specific to the seal's claimed sender. Surfacing this is
    // what actually tells us whether that pubkey is well-formed or not.
    err.sealPubkey = seal.pubkey;
    err.sealPubkeyType = typeof seal.pubkey;
    err.sealPubkeyLength = typeof seal.pubkey === "string" ? seal.pubkey.length : null;
    err.sealContentLength = typeof seal.content === "string" ? seal.content.length : null;
    err.sealKind = seal.kind;
    throw err;
  }
  const rumor = JSON.parse(rumorJson);
  return rumor;
}
/**
 * Gift-wraps the same message twice: once for the recipient, once for the
 * sender's own pubkey (so it shows up in the sender's own "sent" history
 * across any NIP-17-aware client) — standard NIP-17 practice.
 */
export async function giftWrapForBoth({
  eventTemplate,
  senderPubkey,
  recipientPubkey,
  authNip44Encrypt,
  authSignEvent,
}) {
  const toRecipient = await giftWrap({
    eventTemplate,
    senderPubkey,
    recipientPubkey,
    authNip44Encrypt,
    authSignEvent,
  });
  const toSelf = await giftWrap({
    eventTemplate,
    senderPubkey,
    recipientPubkey: senderPubkey,
    authNip44Encrypt,
    authSignEvent,
  });
  return [toRecipient, toSelf];
}
