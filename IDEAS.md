# Sound Coffee — Ideas Bin

Things we've deliberately decided to defer, not forgotten — pick any of
these up whenever it's actually time.

---

## Embedded Nostr feed

Show Sound Coffee's own Nostr posts directly on the site (Listening
Lair or its own page), rather than linking out to Primal/another
client.

**Why embed instead of link out:** sending people to a third-party
client is a rough first touch for anyone who's never used Nostr — a
foreign UI, unrelated timeline, its own login. An embedded feed keeps
people in Sound Coffee's own branded experience the whole time, the
same way checkout and episode zapping already work without anyone
needing to understand what Nostr is.

**Why it's not actually starting from zero:** most of the pieces
already exist elsewhere in this codebase — a note/reply display
pattern (episode comments), a zap flow that already supports zapping
an arbitrary event by id (`ZapModal`'s `eventId` prop isn't
episode-specific), guest identity creation for frictionless
interaction, image handling for embedded media. This is largely
existing pieces pointed at kind 1 notes instead of listings/episodes.

**Recommended shape:** embedded feed as the primary way to see it
(read + reply + zap, guest-friendly), plus a small secondary "view on
Nostr" link for people who already have a preferred client and want
their own notification setup instead.

**Scope note:** bigger than a one-file change — closer in size to the
shipping/fulfillment work than a quick addition. Worth its own pass.

---

## Automatic marketplace revenue-share payouts

Paying a percentage of sales back to Conduit (or any other
Gamma-compatible app that sends real orders our way).

**Status:** reliable reporting comes first. We already track order
source (the SOURCE column on the orders dashboard), which is the
foundation this would build on.

**Recommended flow, when it's time:** batch settlement, not automatic
per-transaction splitting — track qualifying paid orders by source,
total them up periodically, send one lump-sum Lightning payment. Much
simpler than per-order splitting, and how most real affiliate/referral
programs actually work.

**Open question:** whether Conduit (or anyone else) actually
expects/charges this at all, versus it being a voluntary thank-you —
worth a real conversation with them before picking a rate.

---

## V4V 2.0 recipient-side bot

Publish-side support is live (every zap publishes a boostagram
sidecar). The recipient side — a bot that watches settled Lightning
payments and matches them to Nostr sidecar events — needs direct
access to settled-payment records, which Minibits doesn't expose.

**Status:** blocked on the same underlying decision as NWC/LUD-21
below — this doesn't move until that does. Reference implementation
(localbitcoiners) runs this against Alby Hub specifically.

---

## Otis's own wallet verification (NWC)

Connecting Sound Coffee's own receiving wallet via NWC so payment
settlement can be verified directly, instead of relying on LUD-21
support varying by wallet (or the manual "I've paid" fallback).

**Status:** still deciding. Directly related to the node/Alby Hub
question below — same root fix either way.

---

## Running real Lightning infrastructure (Alby Hub / BTCPay)

Minibits doesn't reliably support LUD-21 verification or NIP-57
receipt publishing, and has no API for the V4V 2.0 bot above. Raw
self-hosted LND is real operational overhead (channel management,
inbound liquidity, backup discipline) — probably overkill for where
Sound Coffee is right now.

**Recommendation on the table:** Alby Hub — meaningfully less overhead
than raw LND, NWC-native, and it's literally what the V4V 2.0
reference bot runs against. BTCPay Server is the other reasonable
option if more merchant-specific tooling is wanted later.

**Status:** not decided. Solves three things at once if it happens:
reliable payment verification, NWC, and the V4V 2.0 bot.

---

## Editing individual product variations

`/sell` supports editing simple listings and variable-product parent
fields, and deleting individual variations — but not editing one
variation's own fields (price, stock, images) directly. Right now
that's delete-and-recreate.

**Status:** explicitly fine as-is for now ("delete variations is fine,
let's keep that simple"). Revisit if it becomes a real annoyance.

---

## Persistent accounts with purchase history

Letting someone create a real (non-guest, non-ephemeral) account at
checkout that remembers past orders and could later tie into
whatever club/membership features come back.

**Status:** not started. Original Club membership backend still exists
dormant in the codebase (KV stats, zap-based qualification) if this
ever gets revisited.

---

## Smart buy-button label

Currently keyword-matches the listing title (coffee → "BUY BEANS",
shirt → "BUY SHIRT", etc.) rather than using real product-type
awareness. Fine for what's actually sold today; would need a manual
override field in `/sell` if it ever produces a wrong/awkward label
for something new.
