import { SOUND_COFFEE_PUBKEY } from "./identities";

// Every seller whose NIP-99 listings show up in the Shop. Today it's just
// Sound Coffee itself — once club members can list their own goods, each
// one becomes another entry here, and the Shop's ?seller= filter (and the
// "Buy Coffee" button linking to it) will scope to just their listings.
export const SELLERS = [
  {
    id: "sound-coffee",
    name: "Sound Coffee",
    pubkey: SOUND_COFFEE_PUBKEY,
  },
];
