import { SimplePool } from "nostr-tools/pool";

// A solid, widely-reliable set of default relays to query when we don't
// (yet) know a specific person's own relay list (that's what NIP-65 relay
// lists are for — something to wire in later for smarter per-user lookups).
// For now, every part of the site that needs to read from Nostr shares
// this same list.
export const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://relay.primal.net",
  "wss://nos.lol",
  "wss://relay.nostr.band",
];

let dmRelayPool;
function getDmRelayPool() {
  if (!dmRelayPool) dmRelayPool = new SimplePool();
  return dmRelayPool;
}

/**
 * Looks up a person's preferred DM inbox relays (NIP-17, kind 10050).
 * Falls back to DEFAULT_RELAYS if they haven't published one — meaning
 * without this, a NIP-17 message could easily land somewhere the
 * recipient never checks.
 */
export async function getDmRelaysFor(pubkey) {
  try {
    const event = await getDmRelayPool().get(DEFAULT_RELAYS, {
      kinds: [10050],
      authors: [pubkey],
    });
    const relays = event?.tags.filter((t) => t[0] === "relay").map((t) => t[1]) || [];
    return relays.length > 0 ? relays : DEFAULT_RELAYS;
  } catch {
    return DEFAULT_RELAYS;
  }
}
