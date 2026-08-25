# Setting up the background worker

This runs alongside the website (same Cloudflare project) and does the
jobs a plain website can't: registering orders, talking to Branta, and
running the scheduled check for payments/boosts every 5 minutes.

## One-time setup

### 1. Create the KV namespace (where order/membership data is stored)

```
npx wrangler kv namespace create SOUND_COFFEE_KV
```

This prints an `id`. Copy it into `wrangler.jsonc`, replacing
`REPLACE_WITH_YOUR_KV_NAMESPACE_ID`.

### 2. (Optional, for the "verified merchant" badge) Set up Branta

1. Sign up at https://branta.pro
2. Get your API key from their dashboard
3. Set it as a secret (never put this in a file that gets committed):

```
npx wrangler secret put BRANTA_API_KEY
```
(paste the key when prompted)

If you skip this, checkout still works fine — the "Verify with Branta"
link just won't appear.

### 3. Deploy

Same as always:

```
npm run deploy
```

This deploys both the site and the worker together — they're one
Cloudflare project. The cron job (every 5 minutes) starts running
automatically once deployed.

## What it's doing every 5 minutes

- Checks Nostr relays for zap receipts sent to the Sound Coffee npub of
  100 sats or more, and adds qualifying pubkeys to the club membership
  list stored in KV.
- Checks any pending coffee orders — if the Lightning provider supports
  it (LUD-21), it can confirm payment automatically. If not, the buyer's
  own "I've paid" confirmation (sent as an encrypted Nostr DM) is the
  fallback record.

## Checking who's in the club

```
curl https://your-site.pages.dev/api/club-members
```

Returns the current list as JSON. A nicer on-site admin view is a
reasonable next step once this is running for real.

## Being honest about where this stands

This was built without being able to deploy it against a real Cloudflare
account or test it against live relays/invoices — the bundling step
passed cleanly (a good sign), but the first real deploy should be treated
as a debugging session together, not a sure thing. Send me whatever
errors show up in the Cloudflare dashboard's logs and we'll sort them out.
