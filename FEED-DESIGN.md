# Feed Design — Sound Coffee's Nostr posts, embedded on-site

Design only. Not built, not wired into any page or nav. Written so
building it later doesn't require re-deriving any of this thinking.

## What "the feed" actually means — two distinct categories

**Posts FROM Sound Coffee** — kind 1 notes authored by
`SOUND_COFFEE_PUBKEY`. Straightforward: one relay filter,
`{kinds:[1], authors:[SOUND_COFFEE_PUBKEY]}`.

**Posts ABOUT Sound Coffee** — genuinely fuzzier, and worth being
explicit about what counts:
- Replies to our own notes (kind 1, `e` tag referencing one of ours,
  NIP-10 reply/root markers)
- Mentions/tags (kind 1, `p` tag referencing `SOUND_COFFEE_PUBKEY`)
- Quotes of our own published events — a listing (`a` tag referencing
  a `30402:...` coordinate) or an episode note (`e` tag referencing
  one of the notes already published via the existing "PUBLISH NOTE"
  admin feature)

These need separate relay filters and should probably be visually
distinct in the UI — our own posts are primary content, mentions/
replies are more like social proof, secondary but genuinely valuable
(this is where a customer's public "just got my order, great coffee"
would show up, which is worth surfacing prominently when it happens).

## Don't query relays live on every page load

Given everything this project has learned about relay reliability,
querying live on each visit is the wrong default — same reasoning that
led to D1 becoming authoritative for orders instead of scanning
relays fresh every time. The design:

- **A background Worker job** (extends the existing 5-minute scheduled
  handler, same pattern as zap detection) periodically scans for new
  posts in both categories, using the *same dynamic relay discovery*
  already built for zap detection (`getZapSearchRelays` /
  `/api/relays`) rather than a fresh hardcoded list.
- **New D1 table**, `feed_posts`: `id`, `pubkey`, `content`,
  `created_at`, `category` (`own` | `mention` | `reply` | `quote`),
  `reply_to_id` (nullable), `tags_json`, `fetched_at`.
- **New endpoint**, `GET /api/feed` — serves the cached, already-
  categorized results, paginated. Fast, reliable, no relay round-trip
  on page load.

## Reading: mostly reused infrastructure, not new plumbing

- Author name/avatar: already-existing profile-fetching pattern
  (`useProfile`)
- A `FeedPost` component: title/content/timestamp/avatar display,
  structurally similar to what `EpisodeComments` already does
- Engagement (zap totals, reply counts): same aggregation pattern
  already used for episode zaps

## Writing (reply/zap): no new backend needed at all

This is the part that's genuinely cheap, because it's *already built*:
- Zapping any post: `ZapModal` already accepts an arbitrary `eventId`
  — it isn't episode-specific despite being named for that use today
- Replying: a `ReplyComposer` (new, small — content field, "post"
  button) using `useEnsureIdentity`, the same guest-friendly signing
  path checkout and zapping already use. A guest reading the feed can
  reply or zap with zero account setup, exactly like buying coffee.
- Both publish directly client-side straight to relays — no Worker
  involvement needed for writes, only for the background read/cache
  job above.

## Moderation — worth designing in from the start, not bolting on later

"Posts about us" means anyone can tag our pubkey, including spam or
abuse. Cheap, effective design: a dismiss mechanism in the admin view,
same pattern as the existing dismissed-orders feature (a KV-stored id
list, checked client-side before rendering). No new infrastructure
category, just the same pattern applied here too.

## Where it would live

Leaning toward a dedicated `/feed` page rather than folding it into
Listening Lair — it's a genuinely distinct content category (social
presence vs. podcast episodes), and cramming both into one page risks
neither reading clearly. A small teaser/link from the homepage or
Listening Lair footer is enough to surface it without crowding
either existing page.

## Real open questions, not yet decided

- Should replies TO customer mentions get any special treatment (e.g.
  surfaced to you for a response), similar to how unassigned order
  messages get flagged? Feels related to the existing "customer
  message" concern from the orders dashboard — possibly worth unifying
  eventually rather than building a second, separate "things needing a
  response" concept.
- Pagination/infinite-scroll vs. a simple "load more" — no strong
  opinion yet, revisit once there's actual content to look at.
- Whether "quotes of our listings" is valuable enough to build for
  launch, or worth deferring to a v2 — it's the most complex of the
  three "about us" categories to detect reliably and probably the
  lowest-volume in practice.
