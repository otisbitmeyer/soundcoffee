# Sound Coffee — Ideas Bin

Things we've deliberately decided to defer, not forgotten — pick any of
these up whenever it's actually time.

---

## Sticky global audio player & basic radio queue

**Status: steps 1-3 built and live.** Global player context with
queue support, sticky bottom player bar, and a `/radio` page for
building a station by queuing episodes across feeds. Only the
zap-split/multi-user layer (step 4, folds into the Zap-Split Radio
Feed entry below) remains undone.

**What's actually built:**
- `PlayerContext` — shared audio state (queue, current track,
  play/pause, seek) at the root layout, survives navigation between
  pages. A single real `<audio>` element, not one per episode.
- Bottom-positioned `PlayerBar` — shows current track, progress
  (seekable), prev/next, only renders once something's actually
  queued or playing.
- `/radio` — queue builder, iterates `PODCAST_FEEDS` (already
  structured for multiple feeds, even though only Sound Coffee's own
  show is in it today) with a queue panel above.
- Chapter-seek fully rewired through the shared context
  (`seekToChapter`) instead of reaching into a local `audioRef` — the
  refactor this was flagged as needing before it could happen.
- Auto-advance to the next queued track on end, via a real explicit
  `.play()` call synced to track changes — not relying solely on the
  `autoPlay` HTML attribute, which browsers don't consistently honor
  when a `src` changes on an already-mounted element rather than on
  initial load.

**Deliberate design choice for step 4's sake:** every queued track
carries its full identifying metadata (guid, title, feed source) —
not just an audio URL. A future coordinator can reference and act on
real tracks without this data model needing to change. The queue
itself is purely local/client-side for now (localStorage, same
pattern as the cart) — no server coordination, which is the correct
scope boundary until multi-user shared queues actually become the
goal.

**Honest, unavoidable limitation, unchanged:** only works within a
single browser session. Client-side navigation is fine, an actual
page reload or leaving the site stops playback — that's just how
browser audio works.

**Still not built:** the Media Session API (lock-screen/media-key
controls) — genuinely nice, not done, still fair game to add without
disrupting anything above it, since the metadata plumbing already
exists on each track object.

**What step 4 (zap-splitting, multi-user queues) actually needs on
top of this** — see the Zap-Split Radio Feed entry immediately below,
which now assumes this foundation exists rather than needing to
design it too.

---

## Zap-Split Radio Feed

A continuous "radio" feed that streams podcast episodes back-to-back,
with zaps received during playback automatically split with whichever
podcast is currently airing. Zaps can also function as a live queueing
signal for what plays next. Playlist construction can be restricted to
a defined community (e.g. Coffee Club members).

**Structure**
- Radio feed = a playlist of pointers to episodes in their native
  feeds, not duplicated content.
- Two protocol options for the playlist substrate:
  - Custom: our own `remoteItem`/`a`-tag convention, fully
    self-controlled.
  - Decentralized Lists NIP (draft, kind 9998/39998 headers +
    9999/39999 items — found via research into `nostr-rss-lists`, an
    nsite app for community-curated feed lists): generalizes NIP-51
    so list items are community-contributed rather than author-only,
    with approval/disapproval via ordinary NIP-25 reactions. A closer
    conceptual fit for the queue since it's built for open
    contribution + voting, but it's an unratified draft on a fork —
    treat kind numbers as provisional.
- Each participating podcast keeps its own dedicated feed with its own
  host-split, same as today.

**Tracking "currently playing"**
- Coordinator Worker (fits existing Cloudflare/D1-authoritative
  pattern) owns the queue and "now playing" pointer.
- Coordinator also publishes an ephemeral event (kind 20000–29999)
  announcing current playback for Nostr-native discoverability by
  clients.

**Zap routing**
- Naive passthrough won't work — coordinator must intercept NIP-57
  zap requests to the radio feed, look up current "now playing," and
  construct the invoice with that episode's host-split before it hits
  the LN backend. This is the hardest and most load-bearing piece —
  worth prototyping/diagnostic-testing before building the queue
  layer.
- Alternative (simpler, worse UX): fixed radio-level split +
  post-hoc batch reconciliation against logged playback history.
  Doesn't support live "vote for next."

**Zap-driven queueing (extension)**
- Highest-zapped pending item jumps the queue.
- Needs a tag convention to disambiguate "zap = vote for queue" vs
  default "zap = currently playing" (e.g. `["zap-intent", "vote"]`),
  or use NIP-25 reactions/zap-counts on Decentralized-List item events
  if that route is chosen.

**Restricting playlist construction to community members**
- Not something either protocol enforces natively — the Decentralized
  Lists NIP is explicitly agnostic about curation/spam prevention.
  Enforcement is our responsibility, at one of three layers:
  1. Relay-level allow-listing (only accept writes from member
     pubkeys) — clean but requires running our own relay.
  2. Coordinator-side filtering (recommended): coordinator checks
     playlist-item author pubkeys against a membership list before
     queuing, discarding non-member submissions. Same shape as
     D1-is-authoritative for orders.
  3. Tie membership check to existing Coffee Club membership data in
     D1 — reuses infra rather than building separate access control.
- Open decision to resolve before building: does "restricted" mean
  only members can add tracks, or only members' zap-votes count
  toward reordering (anyone can zap, but member-zaps move the queue)?
  Different product decisions, same filtering mechanism.

**Sequencing when this comes off the backlog**
1. Coordinator + "now playing" state tracking
2. Zap-split routing (prove this works before investing further)
3. Membership-gated queue submission
4. Zap-driven queue voting

**Open questions**
- Clock skew/latency between actual audio playback and coordinator's
  "now playing" state — risk of misattribution at track transitions.
- Rate-limiting/debouncing queue-jump votes so one large zap can't
  dominate.
- Multi-relay consistency for the ephemeral "now playing" event if
  listeners pull from different relays than the coordinator publishes
  to.
- Protocol choice (custom vs. Decentralized Lists NIP) needs deciding
  before the coordinator's data model is built.

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

**Status: attempted three times total now. Removed again.** This time,
six distinct, individually-verified bugs were found and fixed in a
single session — genuinely substantial progress — and it *still*
didn't work in real testing. Full detail below, because this is enough
real diagnostic work that a fourth attempt shouldn't have to
rediscover any of it.

**What got fixed this round, all verified against real sources, not
guesses:**
1. **Wrong metadata format** — we were sending separate `name`/`url`
   query params; Amber's own team documents a single JSON-encoded
   `metadata` param instead. This fix visibly changed behavior (got
   past the initial connection step for the first time), confirming
   it was real.
2. **Missing `perms`** — we never declared which permissions
   (`get_public_key`, `sign_event`, `nip44_encrypt`, `nip44_decrypt`)
   we'd need upfront, which the spec supports specifically so a
   signer can grant them all in one approval instead of prompting
   separately for each action.
3. **Unwanted automatic relay-switching** — `BunkerSigner.fromURI`
   silently calls `switchRelays()` right after a successful connect
   unless told not to (`skipSwitchRelays: true`). Found by reading the
   library's own source line by line.
4. **Missing `onauth` handler** — NIP-46 lets a signer respond "open
   this URL to finish authorizing" instead of answering directly.
   Without a handler for that, the library logs a console warning and
   the request just hangs forever — a precise mechanical match for
   "connected, but no response," since a response genuinely had
   arrived, we just had nothing to receive it.
5. **General-purpose relays instead of a NIP-46-dedicated one** — an
   actual implementation HOWTO (nostrconnect.org, written by people
   who've built working NIP-46 clients) explicitly warns that
   general-purpose relays may not handle NIP-46's ephemeral event kind
   the same way a relay built for it does. Added
   `relay.nsecbunker.com`, a real relay used in the wild for exactly
   this.
6. **No visibility into silent library warnings** — added live capture
   of `console.warn` output directly into the UI, since the library
   uses it for a couple of silent-failure paths that never surface as
   thrown errors at all.

**Still failed after all six.** Error stayed "connected, but didn't
get a response for your public key" throughout.

**Important context found along the way, worth remembering:** a
direct, first-hand assessment from a knowledgeable Nostr developer,
evaluating NIP-46 apps specifically: *"Why is nak the only NIP-46 app
that actually works? Runner-up is Amber which mostly works but still a
bit finicky."* That's someone in the ecosystem itself saying Amber —
not a fringe or abandoned app — isn't fully reliable even in their own
experience. "Other apps successfully use this" and "this protocol is
still genuinely inconsistent in practice" are both true at once.

**What would actually move this forward next time:** live,
side-by-side debugging with someone who has Amber installed — ideally
checking Amber's own internal logs/state during a real attempt, not
just the end symptom on our side. The captured-warnings UI (point 6
above) is still in the codebase's history if the tab gets rebuilt —
worth restoring that specifically, since it's exactly the kind of
visibility this needs.

**Immediate practical alternative for logging in from a phone right
now:** the "IMPORT KEY" tab works everywhere, including mobile
browsers — paste an nsec directly to log in for that session. Less
secure than a proper remote-signer flow (that's the whole reason NIP-46
exists), and it doesn't persist across visits by design, but it's
completely reliable today if there's a real, current need to check the
dashboard from a phone.

**Code status:** `loginWithBunker`, `startNostrConnect`, and
`awaitNostrConnectApproval` are still in AuthContext, dormant, all six
fixes intact in the code — not wired into any UI. A future attempt
starts from a meaningfully better place than either previous one did.

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

Show Sound Coffee's own Nostr posts (and posts about Sound Coffee —
mentions, replies) directly on the site, rather than linking out to
Primal/another client.

**Full technical design written up in `FEED-DESIGN.md`** — data model,
background caching architecture, what's genuinely reused vs. new,
moderation approach, and real open questions. Not built, not wired in
anywhere. Read that file before starting rather than re-deriving the
architecture from scratch.

**The short version of why embed instead of link out:** sending people
to a third-party client is a rough first touch for anyone who's never
used Nostr. An embedded feed keeps people in Sound Coffee's own
branded experience the whole time, same as checkout and episode
zapping already do.

**Scope note:** bigger than a one-file change — closer in size to the
shipping/fulfillment work than a quick addition.

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
