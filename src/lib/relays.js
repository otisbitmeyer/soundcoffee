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
