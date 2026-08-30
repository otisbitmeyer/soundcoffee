# Sound Coffee — Ideas Bin

Things we've deliberately decided to defer, not forgotten — pick any of
these up whenever it's actually time.

---

## Autonomous order detection (Conduit/external orders while offline)

Right now, detecting orders from other apps (Conduit, etc.) — and the
email alert and inventory decrement that depend on it — only runs when
`/admin/orders` is loaded in a browser. No dashboard visit, no
detection, no matter how long an order's been sitting there. Zap
detection has an independent background job checking every 5 minutes
regardless of whether anyone's looking; external order detection
doesn't have an equivalent.

**Why it's not built:** the real fix requires the Worker to
autonomously decrypt incoming NIP-17/NIP-04 order messages without a
browser session open, which means it needs real decrypting capability
for Sound Coffee's identity on its own — explicitly declined (raw key
as a Worker secret is a real trust boundary, reasonably so).

**The chosen path forward, once it's time:** NOT a server-held key.
Add an auto-refresh timer to the orders dashboard (e.g. every 5
minutes) and leave one browser tab open somewhere, logged in via
extension — the exact same decryption that already happens today when
someone's actively looking, just automatic instead of manual. Pair
with the browser's own Notification API so that tab can surface a real
desktop alert instead of silently updating in the background. Your
key never leaves your own extension either way.

**Alternative considered and set aside:** a NIP-46 remote-signer
connection for the Worker itself (same idea as Amber login, but for
this specific job). Not recommended given our own documented
experience — two separate, careful NIP-46/Amber attempts both failed
in real testing this session (see the Amber login section below).
Worth naming as an option, not worth depending on based on what we've
actually seen work.

---

## Amber login (NIP-46 remote signer)

**Status: re-enabled with a real fix, worth testing again.**

Attempted twice before and both failed — but on being pushed to
actually check whether the problem was on our end rather than
assume protocol immaturity, found a concrete bug: Amber's own team
documents the nostrconnect:// URI as expecting a single JSON-encoded
`metadata` parameter (`{"name":"...","url":"...","description":"..."}`),
not separate `name`/`url` query params, which is what the more
generic NIP-46 examples show and what we'd actually built. Fixed to
match Amber's documented format specifically, keeping the plain
`name` param too as a harmless redundant fallback for other signers.

Previous attempts (bunker:// paste flow, then nostrconnect:// without
the correct metadata format) are still documented below for context —
both real, careful attempts with real fixes along the way, just not
the actual root cause.

Letting people log in via Amber (Android) instead of a browser
extension or pasted key.

**Status: attempted twice, both failed in real device testing.** Worth
reading this before trying a third time.

**Attempt 1 — `bunker://` (paste flow):** Amber generates a connection
string, user pastes it into our site. Matched Amber's own
documentation. Diagnosed and fixed a real bug along the way (the
underlying library's `connect()` has no built-in timeout at all — could
hang forever with zero feedback on a failed connection). Even with that
fixed, connection never actually completed — no further diagnosable
error, just silent failure.

**Attempt 2 — `nostrconnect://` (QR/deep-link flow):** the reverse
direction — we generate the connection request, user scans/opens it in
Amber. Verified the exact wire protocol (kind 24133, NIP-44 encryption,
secret-matching handshake) against the real spec before building,
confirmed the constructed URI round-trips correctly through the
library's own parsing. Got further than attempt 1 — Amber genuinely
recognized and displayed the connection request — but hit two real
issues:
- First error: `"Subscription was closed before connection was
  established"` — fixed by using multiple relays instead of one (the
  spec supports repeating the `relay` param; we were only using one,
  no redundancy).
- After that fix: Amber kept prompting to "replace" an existing
  connection on every retry. Diagnosed as orphaned subscriptions from
  previous attempts never being cleanly cancelled — fixed using a
  proper `AbortController`, aborting the prior attempt before starting
  a new one.
- **Still didn't work after both fixes.** Removed rather than continue
  guessing blind without real device access to actually debug further.

**What would actually move this forward:** live debugging with someone
who has Amber installed and is willing to check Amber's own logs/state
during a real attempt, not just report the end symptom. Both fixes
made were well-reasoned and verified against real protocol specs, not
guesses — but NIP-46 as a whole is acknowledged by experienced Nostr
developers as still not reliable across the ecosystem generally, so
some of this may be inherent to the protocol's current maturity, not
purely something fixable in our own code.

**Code status:** the AuthContext functions (`loginWithBunker`,
`startNostrConnect`, `awaitNostrConnectApproval`) are still there,
dormant, not wired into any UI. Easy to resume from here rather than
starting over, if picked back up.

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
