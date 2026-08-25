// The Sound Coffee show/brand's own Nostr identity — used as the zap
// recipient for the podcast, and as the author to pull NIP-99 product
// listings from for the Shop section.
//
// ASSUMPTION TO CONFIRM: this is the "COFFEE SOUND" npub credited in the
// show notes (distinct from Otis' and Fundamentals' personal npubs). If
// products/zaps should instead go to a different identity, just swap the
// value below — everything else references this one constant.
export const SOUND_COFFEE_NPUB =
  "npub186pzq2z7xjma6gsjkm4kyeyvfck0lk4t9a6qmtht2pq9axyr73wshad0rk";

export const SOUND_COFFEE_PUBKEY =
  "3e8220285e34b7dd2212b6eb62648c4e2cffdaab2f740daeeb50405e9883f45d";
