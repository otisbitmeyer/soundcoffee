// Sound Coffee background worker.
//
// Runs alongside the static site (same Cloudflare Workers project).
//
//   1. HTTP API — registers pending payments (zaps + purchases) from the
//      site, serves member stats, proxies to Branta.
//
//   2. Scheduled job (cron, every 5 min) — checks pending payments for
//      settlement, and (as a bonus, best-effort check) also watches
//      relays directly for zap receipts, in case a payment happens
//      through some other Nostr client entirely. Maintains cumulative
//      per-pubkey stats and derives club membership from them.
//
// Membership rule: total confirmed zaps >= MIN_BOOST_SATS, OR at least
// one confirmed coffee purchase.
//
// NOTE: built without direct access to deploy/test against real
// Cloudflare infrastructure — see WORKER-SETUP.md.

import { SimplePool } from "nostr-tools/pool";

const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://relay.primal.net",
  "wss://nos.lol",
  "wss://relay.nostr.band",
];

// A wider set specifically for zap-receipt scanning — a boost from an
// unfamiliar wallet/client could easily publish its receipt somewhere
// outside the narrow 4-relay default, and this was silently missing
// those with no way to tell. Matches the set the orders dashboard
// already searches for the same reason.
const ZAP_SEARCH_RELAYS = [
  ...DEFAULT_RELAYS,
  "wss://relay.snort.social",
  "wss://nostr.wine",
  "wss://relay.nostr.bg",
  "wss://offchain.pub",
  "wss://relay.mostr.pub",
  "wss://relay.nostrplebs.com",
  "wss://relay.conduit.market",
];

const RELAY_CACHE_KEY = "nostr-watch-relay-cache";
const RELAY_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // refresh roughly daily
const RELAY_SAMPLE_SIZE = 25; // keep cron runs fast — not querying hundreds of relays every 5 min

/**
 * Returns the relay set to search for zaps/boosts — DEFAULT_RELAYS
 * (always known-good) plus a sample of currently-online relays from
 * nostr.watch's public API, refreshed roughly daily and cached in KV.
 * If nostr.watch is unreachable, returns unexpected data, or the cache
 * is simply empty, this always falls back to our hardcoded
 * ZAP_SEARCH_RELAYS — a relay-discovery outage should never be able to
 * break zap detection entirely.
 */
async function getZapSearchRelays(env) {
  try {
    const cached = await env.SOUND_COFFEE_KV.get(RELAY_CACHE_KEY);
    if (cached) {
      const { relays, fetchedAt } = JSON.parse(cached);
      if (relays?.length && Date.now() - fetchedAt < RELAY_CACHE_MAX_AGE_MS) {
        return [...new Set([...DEFAULT_RELAYS, ...relays])];
      }
    }
  } catch {
    // Malformed cache entry — fall through and refresh.
  }

  try {
    const res = await fetch("https://api.nostr.watch/v1/online");
    if (!res.ok) throw new Error(`nostr.watch returned ${res.status}`);
    const data = await res.json();

    // Defensive parsing — response could plausibly be a flat array of
    // URL strings, or an array of objects with a url-like field. Never
    // trust a third-party API's exact shape without a fallback.
    let relayUrls = [];
    if (Array.isArray(data)) {
      relayUrls = data
        .map((r) => (typeof r === "string" ? r : r?.url || r?.relay))
        .filter((url) => typeof url === "string" && url.startsWith("wss://"));
    }

    if (relayUrls.length > 0) {
      // A random sample rather than always the same first N — spreads
      // coverage across different relays over time instead of only ever
      // checking whichever ones happen to sort first.
      const sample = relayUrls.sort(() => Math.random() - 0.5).slice(0, RELAY_SAMPLE_SIZE);
      await env.SOUND_COFFEE_KV.put(
        RELAY_CACHE_KEY,
        JSON.stringify({ relays: sample, fetchedAt: Date.now() })
      );
      return [...new Set([...DEFAULT_RELAYS, ...sample])];
    }
  } catch {
    // nostr.watch unreachable, rate-limited, or returned something we
    // didn't expect — fall through to the safe hardcoded list below.
  }

  return ZAP_SEARCH_RELAYS;
}

const SOUND_COFFEE_PUBKEY =
  "3e8220285e34b7dd2212b6eb62648c4e2cffdaab2f740daeeb50405e9883f45d";

// The show's real Podcast Index GUID — see src/lib/identities.js for
// where this comes from and why it matters for finding boosts sent
// through the wider Podcasting 2.0 / Nostr ecosystem, not just our site.
const SOUND_COFFEE_SHOW_GUID = "de47e794-c0a3-4bb4-8712-cce1e4566b7e";
const SHOW_I_TAG = `podcast:guid:${SOUND_COFFEE_SHOW_GUID}`;
const EPISODE_I_PREFIX = "podcast:item:guid:";
const LEGACY_EPISODE_I_PREFIX = "podcast:episode:"; // our own pre-fix convention

const MIN_BOOST_SATS = 100;

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

// ---------------------------------------------------------------------
// Stats helpers
// ---------------------------------------------------------------------

async function getStats(env, pubkey) {
  const raw = await env.SOUND_COFFEE_KV.get(`stats:${pubkey}`);
  return raw
    ? JSON.parse(raw)
    : {
        pubkey,
        totalZapSats: 0,
        zapCount: 0,
        totalPurchaseSats: 0,
        purchaseCount: 0,
        isMember: false,
        memberSince: null,
        firstSeenAt: null,
        lastActivityAt: null,
      };
}

async function recordConfirmedPayment(env, { pubkey, type, amountSats, sourceId }) {
  // Guest checkout/zapping creates a real, one-time signed Nostr identity
  // — indistinguishable from a "real" user's once it's broadcast to
  // relays. That means even a completely independent relay scan (or a
  // full recompute) would otherwise credit membership to a key nobody
  // will ever use again. We mark known guest pubkeys permanently at
  // creation time (see handlePendingPayment) and check it here — the one
  // place every membership-crediting path (our own registration, the
  // relay scan, and recompute) all funnel through — so a throwaway
  // identity can never accumulate club membership, regardless of which
  // path discovers its activity.
  const isKnownGuest = await env.SOUND_COFFEE_KV.get(`guest-pubkey:${pubkey}`);
  if (isKnownGuest) return;

  const stats = await getStats(env, pubkey);

  // Idempotency — don't double-count if this exact payment was already
  // recorded (the polling loop can see the same settled invoice twice).
  const seenKey = `seen:${sourceId}`;
  if (await env.SOUND_COFFEE_KV.get(seenKey)) return;
  await env.SOUND_COFFEE_KV.put(seenKey, "1", { expirationTtl: 60 * 60 * 24 * 90 });

  if (type === "zap") {
    stats.totalZapSats += amountSats;
    stats.zapCount += 1;
  } else if (type === "purchase") {
    stats.totalPurchaseSats += amountSats;
    stats.purchaseCount += 1;
  }

  const now = Date.now();
  if (!stats.firstSeenAt) stats.firstSeenAt = now;
  stats.lastActivityAt = now;

  const qualifies = stats.totalZapSats >= MIN_BOOST_SATS || stats.purchaseCount > 0;
  if (qualifies && !stats.isMember) {
    stats.isMember = true;
    stats.memberSince = now;
  }

  await env.SOUND_COFFEE_KV.put(`stats:${pubkey}`, JSON.stringify(stats));
}

/**
 * Records a zap tied to a specific podcast episode (via the "i" tag
 * convention in src/lib/episodeId.js). Tracks both a running total (for
 * "top episodes" ranking) and the individual entry with its comment (for
 * the per-episode comment feed) — separate concerns, so both get stored.
 */
async function recordEpisodeZap(env, { episodeGuid, amountSats, comment, zapperPubkey, sourceId }) {
  const seenKey = `seen-episode:${sourceId}`;
  if (await env.SOUND_COFFEE_KV.get(seenKey)) return;
  await env.SOUND_COFFEE_KV.put(seenKey, "1", { expirationTtl: 60 * 60 * 24 * 90 });

  const totalKey = `episode-total:${episodeGuid}`;
  const existingRaw = await env.SOUND_COFFEE_KV.get(totalKey);
  const existing = existingRaw
    ? JSON.parse(existingRaw)
    : { episodeGuid, totalSats: 0, count: 0 };
  existing.totalSats += amountSats;
  existing.count += 1;
  await env.SOUND_COFFEE_KV.put(totalKey, JSON.stringify(existing));

  const entryKey = `episode-entry:${episodeGuid}:${sourceId}`;
  await env.SOUND_COFFEE_KV.put(
    entryKey,
    JSON.stringify({ amountSats, comment: comment || "", zapperPubkey, at: Date.now() })
  );
}

// ---------------------------------------------------------------------
// HTTP API
// ---------------------------------------------------------------------

async function handlePendingPayment(request, env) {
  const body = await request.json();
  const { id, type, pubkey, sellerPubkey, invoice, verifyUrl, amountSats, episodeGuid, comment, isGuest } = body;

  if (!id || !type || !pubkey || !invoice || !amountSats) {
    return jsonResponse({ error: "Missing required fields." }, 422);
  }
  if (type !== "zap" && type !== "purchase") {
    return jsonResponse({ error: "type must be 'zap' or 'purchase'." }, 422);
  }

  // Permanent marker (no expiration) — this is what keeps a one-time
  // guest identity from ever accumulating club membership, no matter
  // which path (our own registration, an independent relay scan, or a
  // full recompute) later discovers activity from this same pubkey.
  if (isGuest) {
    await env.SOUND_COFFEE_KV.put(`guest-pubkey:${pubkey}`, "1");
  }

  await env.SOUND_COFFEE_KV.put(
    `pending:${id}`,
    JSON.stringify({
      id,
      type,
      pubkey,
      sellerPubkey: sellerPubkey || null,
      invoice,
      verifyUrl: verifyUrl || null,
      amountSats,
      episodeGuid: episodeGuid || null,
      comment: comment || "",
      status: "pending",
      createdAt: Date.now(),
    }),
    { expirationTtl: 60 * 60 * 24 * 30 }
  );

  return jsonResponse({ ok: true });
}

async function handleBrantaVerify(request, env) {
  if (!env.BRANTA_API_KEY) {
    return jsonResponse(
      { error: "Branta isn't configured yet (missing BRANTA_API_KEY)." },
      501
    );
  }

  const { invoice } = await request.json();
  if (!invoice) return jsonResponse({ error: "Missing invoice." }, 422);

  const brantaRes = await fetch("https://guardrail.branta.pro/v2/payments", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.BRANTA_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      destinations: [{ value: invoice, type: "bolt11" }],
      ttl: 3600,
      description: "Sound Coffee order",
    }),
  });

  if (!brantaRes.ok) {
    const errText = await brantaRes.text();
    return jsonResponse({ error: `Branta error: ${errText}` }, 502);
  }

  const verifyLink = `https://guardrail.branta.pro/v1/verify/address?payment=${encodeURIComponent(invoice)}`;
  return jsonResponse({ verifyLink });
}

/**
 * Wraps order-email content in a branded HTML template. Table-based
 * layout with inline styles throughout — not a stylistic choice, it's
 * what actually renders consistently across email clients. Most
 * (Outlook especially) don't support flexbox/grid and many strip
 * <style> blocks entirely. Custom fonts won't load in most clients
 * either, regardless of what's specified — falls back to widely
 * available serif/sans-serif stacks instead.
 *
 * `rows` is an array of { label, value } pairs, rendered as a simple
 * two-column table — the actual order details.
 */
function renderOrderEmailHtml({ heading, intro, rows, ctaText, ctaUrl }) {
  const rowsHtml = rows
    .filter((r) => r.value)
    .map(
      (r) => `
        <tr>
          <td style="padding:6px 0;border-bottom:1px solid #14131122;font-family:Georgia,serif;font-size:13px;color:#14131199;white-space:nowrap;">${r.label}</td>
          <td style="padding:6px 0 6px 16px;border-bottom:1px solid #14131122;font-family:Georgia,serif;font-size:14px;color:#141311;">${r.value}</td>
        </tr>`
    )
    .join("");

  return `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background-color:#faf6ee;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#faf6ee;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:520px;background-color:#ffffff;border:2px solid #141311;">
          <tr>
            <td style="background-color:#141311;padding:16px 24px;">
              <table role="presentation" cellpadding="0" cellspacing="0"><tr>
                <td style="vertical-align:middle;padding-right:10px;">
                  <img src="https://soundcoffee.org/logo-mark.png" width="28" height="29" alt="Sound Coffee" style="display:block;">
                </td>
                <td style="vertical-align:middle;">
                  <span style="font-family:Arial,sans-serif;font-size:11px;letter-spacing:2px;color:#faf6ee;">SOUND COFFEE</span>
                </td>
              </tr></table>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 24px 8px 24px;">
              <h1 style="margin:0 0 12px 0;font-family:Georgia,serif;font-size:20px;color:#141311;">${heading}</h1>
              ${intro ? `<p style="margin:0 0 20px 0;font-family:Georgia,serif;font-size:14px;color:#14131199;line-height:1.5;">${intro}</p>` : ""}
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                ${rowsHtml}
              </table>
              ${
                ctaUrl
                  ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:24px;">
                       <tr><td style="background-color:#141311;">
                         <a href="${ctaUrl}" style="display:inline-block;padding:12px 20px;font-family:Arial,sans-serif;font-size:12px;letter-spacing:1px;color:#faf6ee;text-decoration:none;">${ctaText || "VIEW"}</a>
                       </td></tr>
                     </table>`
                  : ""
              }
            </td>
          </tr>
          <tr>
            <td style="padding:20px 24px;border-top:2px solid #14131111;">
              <span style="font-family:Arial,sans-serif;font-size:10px;letter-spacing:1px;color:#14131166;">SOUND COFFEE — BUILT ON NOSTR</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function sendEmail(env, { to, subject, text, html }) {
  if (!env.RESEND_API_KEY) return { skipped: true };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      // Resend's shared test sender — works immediately with no domain
      // setup. Swap for a verified address on your own domain once one
      // is set up (e.g. orders@soundcoffee.xyz) for better deliverability.
      from: env.EMAIL_FROM || "Sound Coffee <onboarding@resend.dev>",
      to,
      subject,
      text,
      ...(html ? { html } : {}),
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  return { sent: true };
}

/**
 * Notifies the admin that an order was detected on the dashboard —
 * specifically for orders from OTHER apps (Conduit, etc.), which have
 * no other path to trigger an email the way our own checkout does at
 * creation time. Dedup'd in KV so this fires exactly once per order,
 * regardless of how many times the dashboard gets loaded.
 */
async function handleNotifyOrderDetected(request, env) {
  const { orderId, source, itemSummary, amountSats, amountUsdCents, paymentMethod, buyerInfo } =
    await request.json();
  if (!orderId) return jsonResponse({ error: "Missing orderId." }, 422);

  const dedupKey = `order-notified:${orderId}`;
  if (await env.SOUND_COFFEE_KV.get(dedupKey)) {
    return jsonResponse({ ok: true, skipped: "already notified" });
  }

  const amountLine =
    paymentMethod === "card" && amountUsdCents
      ? `$${(amountUsdCents / 100).toFixed(2)}`
      : `${amountSats || 0} sats`;

  try {
    await sendEmail(env, {
      // Hardcoded for now, per explicit request — worth making
      // configurable (e.g. via ADMIN_EMAIL) once there's more than one
      // person who needs these.
      to: "otisbitmeyer@gmail.com",
      subject: `New order detected — ${source || "Sound Coffee"} (${amountLine})`,
      text: [
        "A new order was detected on the orders dashboard.",
        "",
        `Order ID: ${orderId}`,
        `Source: ${source || "Unknown"}`,
        `Amount: ${amountLine}`,
        `Payment method: ${paymentMethod || "unknown"}`,
        itemSummary ? `Item: ${itemSummary}` : null,
        buyerInfo ? `Buyer: ${buyerInfo}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      html: renderOrderEmailHtml({
        heading: "New order detected",
        intro: "Found on the orders dashboard, not placed through checkout directly.",
        rows: [
          { label: "ORDER ID", value: orderId },
          { label: "SOURCE", value: source || "Unknown" },
          { label: "AMOUNT", value: amountLine },
          { label: "PAYMENT METHOD", value: paymentMethod || "unknown" },
          { label: "ITEM", value: itemSummary },
          { label: "BUYER", value: buyerInfo },
        ],
      }),
    });
    await env.SOUND_COFFEE_KV.put(dedupKey, "1", { expirationTtl: 60 * 60 * 24 * 180 });
    return jsonResponse({ ok: true, sent: true });
  } catch (e) {
    return jsonResponse({ error: e.message }, 502);
  }
}

async function handleNotifyOrder(request, env) {
  const body = await request.json();
  const {
    orderId,
    itemTitle,
    quantity,
    amountSats,
    amountUsdCents,
    paymentMethod,
    buyerNpub,
    buyerEmail,
    address,
    notes,
  } = body;

  if (!orderId || !itemTitle) {
    return jsonResponse({ error: "Missing required fields." }, 422);
  }

  // Show the amount in whatever currency was actually paid — sats for
  // Lightning, dollars for card — not always sats regardless of method.
  const amountLine =
    paymentMethod === "card" && amountUsdCents
      ? `$${(amountUsdCents / 100).toFixed(2)}`
      : `${amountSats || 0} sats`;

  const summary = [
    `New order: ${itemTitle} x${quantity || 1}`,
    `Order ID: ${orderId}`,
    `Amount: ${amountLine}`,
    buyerNpub ? `Buyer npub: ${buyerNpub}` : null,
    address ? `Shipping address:\n${address}` : null,
    notes ? `Notes: ${notes}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  const emailRows = [
    { label: "ITEM", value: `${itemTitle} &times;${quantity || 1}` },
    { label: "ORDER ID", value: orderId },
    { label: "AMOUNT", value: amountLine },
    { label: "BUYER NPUB", value: buyerNpub },
    { label: "SHIPPING ADDRESS", value: address ? address.replace(/\n/g, "<br>") : null },
    { label: "NOTES", value: notes },
  ];

  const results = {};

  if (env.ADMIN_EMAIL) {
    try {
      results.admin = await sendEmail(env, {
        to: env.ADMIN_EMAIL,
        subject: `☕ New order: ${itemTitle}`,
        text: summary,
        html: renderOrderEmailHtml({
          heading: "New order received",
          rows: emailRows,
        }),
      });
    } catch (e) {
      results.admin = { error: e.message };
    }
  }

  if (buyerEmail) {
    try {
      results.buyer = await sendEmail(env, {
        to: buyerEmail,
        subject: `Your Sound Coffee order (${orderId})`,
        text: `Thanks for your order!\n\n${summary}\n\nWe'll be in touch about shipping.`,
        html: renderOrderEmailHtml({
          heading: "Thanks for your order!",
          intro: "We'll be in touch about shipping.",
          rows: emailRows,
        }),
      });
    } catch (e) {
      results.buyer = { error: e.message };
    }
  }

  return jsonResponse({ ok: true, results });
}

async function handleNotifyShipped(request, env) {
  const { orderId, buyerEmail, itemTitle, trackingNumber, carrier } = await request.json();
  if (!orderId) return jsonResponse({ error: "Missing orderId." }, 422);
  if (!buyerEmail) return jsonResponse({ ok: true, skipped: "no email on file" });

  const trackingLine = trackingNumber
    ? `\n\nTracking: ${trackingNumber}${carrier ? ` (${carrier})` : ""}`
    : "";

  try {
    await sendEmail(env, {
      to: buyerEmail,
      subject: `Your Sound Coffee order has shipped! (${orderId})`,
      text: `Good news — your order${itemTitle ? ` for ${itemTitle}` : ""} is on its way.${trackingLine}`,
      html: renderOrderEmailHtml({
        heading: "Your order has shipped!",
        intro: "Good news — it's on its way.",
        rows: [
          { label: "ORDER ID", value: orderId },
          { label: "ITEM", value: itemTitle },
          { label: "TRACKING", value: trackingNumber },
          { label: "CARRIER", value: carrier },
        ],
      }),
    });
    return jsonResponse({ ok: true, sent: true });
  } catch (e) {
    return jsonResponse({ error: e.message }, 502);
  }
}

async function handleEpisodeZaps(request, env) {
  const url = new URL(request.url);
  const guid = url.searchParams.get("guid");
  if (!guid) return jsonResponse({ error: "Missing ?guid=" }, 422);

  const totalRaw = await env.SOUND_COFFEE_KV.get(`episode-total:${guid}`);
  const total = totalRaw ? JSON.parse(totalRaw) : { episodeGuid: guid, totalSats: 0, count: 0 };

  const list = await env.SOUND_COFFEE_KV.list({ prefix: `episode-entry:${guid}:` });
  const entries = await Promise.all(
    list.keys.map(async (k) => JSON.parse(await env.SOUND_COFFEE_KV.get(k.name)))
  );
  entries.sort((a, b) => b.at - a.at);

  return jsonResponse({ ...total, entries });
}

async function handleTopEpisodes(request, env) {
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit")) || 4;

  const list = await env.SOUND_COFFEE_KV.list({ prefix: "episode-total:" });
  const all = await Promise.all(
    list.keys.map(async (k) => JSON.parse(await env.SOUND_COFFEE_KV.get(k.name)))
  );
  all.sort((a, b) => b.totalSats - a.totalSats);

  return jsonResponse({ episodes: all.slice(0, limit) });
}

async function handleStats(request, env) {
  const url = new URL(request.url);
  const pubkey = url.searchParams.get("pubkey");
  if (!pubkey) return jsonResponse({ error: "Missing ?pubkey=" }, 422);
  return jsonResponse(await getStats(env, pubkey));
}

async function handleClubMembers(env) {
  const list = await env.SOUND_COFFEE_KV.list({ prefix: "stats:" });
  const all = await Promise.all(
    list.keys.map(async (k) => JSON.parse(await env.SOUND_COFFEE_KV.get(k.name)))
  );
  const members = all.filter((s) => s.isMember);
  return jsonResponse({ members, allStats: all });
}

/**
 * One-time (but safe to re-run anytime) full recompute of every pubkey's
 * stats from primary sources, properly deduplicated. Fixes historical
 * double-counting caused by an earlier bug where a zap discovered via
 * both the pending-payment path and the relay-receipt path was counted
 * twice (they used different, uncorrelated source ids). This rebuilds
 * everything from scratch using the corrected, unified id scheme, so old
 * bad data can't linger.
 */
async function handleRecomputeStats(env) {
  const zapTotals = new Map(); // sourceId -> { pubkey, amountSats }
  const purchaseTotals = new Map(); // sourceId -> { pubkey, amountSats }

  // Source 1: every confirmed payment we registered ourselves (both
  // zaps sent through our site, and purchases).
  const pendingList = await env.SOUND_COFFEE_KV.list({ prefix: "pending:" });
  for (const key of pendingList.keys) {
    const raw = await env.SOUND_COFFEE_KV.get(key.name);
    if (!raw) continue;
    const payment = JSON.parse(raw);
    if (payment.status !== "confirmed") continue;
    const map = payment.type === "zap" ? zapTotals : purchaseTotals;
    map.set(payment.id, { pubkey: payment.pubkey, amountSats: payment.amountSats });
  }

  // Source 2: zap receipts found directly on relays (catches boosts sent
  // through other Nostr clients, not just our site). No time window here
  // — this is a full historical recompute, not the usual incremental
  // check.
  const pool = new SimplePool();
  const zapSearchRelays = await getZapSearchRelays(env);
  try {
    const receipts = await pool.querySync(zapSearchRelays, {
      kinds: [9735],
      "#p": [SOUND_COFFEE_PUBKEY],
    });
    for (const receipt of receipts) {
      try {
        const descriptionTag = receipt.tags.find((t) => t[0] === "description");
        if (!descriptionTag) continue;
        const zapRequest = JSON.parse(descriptionTag[1]);
        const amountTag = zapRequest.tags.find((t) => t[0] === "amount");
        if (!amountTag) continue;
        const amountSats = Math.floor(Number(amountTag[1]) / 1000);
        // Map keyed by the zap REQUEST's id, same as source 1 — this is
        // exactly what makes the dedup work: if this same zap also shows
        // up in source 1, .set() on the same key just overwrites with
        // (identical) data instead of creating a second entry.
        zapTotals.set(zapRequest.id, { pubkey: zapRequest.pubkey, amountSats });
      } catch {
        // malformed receipt — skip it
      }
    }
  } finally {
    pool.close(zapSearchRelays);
  }

  // Aggregate per pubkey.
  const byPubkey = new Map();
  function getEntry(pubkey) {
    if (!byPubkey.has(pubkey)) {
      byPubkey.set(pubkey, {
        pubkey,
        totalZapSats: 0,
        zapCount: 0,
        totalPurchaseSats: 0,
        purchaseCount: 0,
      });
    }
    return byPubkey.get(pubkey);
  }
  for (const { pubkey, amountSats } of zapTotals.values()) {
    const e = getEntry(pubkey);
    e.totalZapSats += amountSats;
    e.zapCount += 1;
  }
  for (const { pubkey, amountSats } of purchaseTotals.values()) {
    const e = getEntry(pubkey);
    e.totalPurchaseSats += amountSats;
    e.purchaseCount += 1;
  }

  // Write back, preserving each pubkey's original memberSince if they
  // were already a member (so this doesn't reset their "member since"
  // date), only assigning a new one if they're newly qualifying. Known
  // guest identities are skipped entirely — see recordConfirmedPayment
  // for why — and any stats they already accumulated (from before this
  // protection existed) get removed here too, so a recompute also
  // cleans up past pollution, not just prevents new pollution.
  const now = Date.now();
  const results = [];
  let guestsSkipped = 0;
  for (const entry of byPubkey.values()) {
    const isKnownGuest = await env.SOUND_COFFEE_KV.get(`guest-pubkey:${entry.pubkey}`);
    if (isKnownGuest) {
      await env.SOUND_COFFEE_KV.delete(`stats:${entry.pubkey}`);
      guestsSkipped++;
      continue;
    }

    const existingRaw = await env.SOUND_COFFEE_KV.get(`stats:${entry.pubkey}`);
    const existing = existingRaw ? JSON.parse(existingRaw) : null;
    const qualifies = entry.totalZapSats >= MIN_BOOST_SATS || entry.purchaseCount > 0;

    const stats = {
      ...entry,
      isMember: qualifies,
      memberSince: qualifies ? existing?.memberSince || now : null,
      firstSeenAt: existing?.firstSeenAt || now,
      lastActivityAt: existing?.lastActivityAt || now,
    };
    await env.SOUND_COFFEE_KV.put(`stats:${entry.pubkey}`, JSON.stringify(stats));
    results.push(stats);
  }

  // Mark every source id as "seen" under the new scheme, so the regular
  // incremental cron doesn't immediately try to re-add any of these.
  for (const id of zapTotals.keys()) {
    await env.SOUND_COFFEE_KV.put(`seen:zap:${id}`, "1", {
      expirationTtl: 60 * 60 * 24 * 90,
    });
  }
  for (const id of purchaseTotals.keys()) {
    await env.SOUND_COFFEE_KV.put(`seen:purchase:${id}`, "1", {
      expirationTtl: 60 * 60 * 24 * 90,
    });
  }

  return jsonResponse({
    ok: true,
    pubkeysRecomputed: results.length,
    uniqueZapsFound: zapTotals.size,
    uniquePurchasesFound: purchaseTotals.size,
    guestsSkipped,
    results,
  });
}

// ---------------------------------------------------------------------
// Stripe (fiat checkout) — the order-creation DM and dashboard stay
// identical regardless of payment rail; only settlement confirmation
// differs. See confirmPayment() below, shared with the Lightning path.
// ---------------------------------------------------------------------

async function handleCreateCheckoutSession(request, env) {
  if (!env.STRIPE_SECRET_KEY) {
    return jsonResponse({ error: "Card payments aren't configured yet." }, 501);
  }

  const { orderId, itemTitle, amountUsdCents, buyerEmail, successUrl, cancelUrl } =
    await request.json();

  // amountUsdCents can legitimately be 0 (a 100%-off discount) — only
  // actually missing values (undefined/null) should be rejected, not
  // a real zero, which was being incorrectly treated the same way.
  if (!orderId || !itemTitle || amountUsdCents == null) {
    return jsonResponse({ error: "Missing required fields." }, 422);
  }

  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("success_url", successUrl);
  params.set("cancel_url", cancelUrl);
  params.set("line_items[0][quantity]", "1");
  params.set("line_items[0][price_data][currency]", "usd");
  params.set("line_items[0][price_data][unit_amount]", String(Math.round(amountUsdCents)));
  params.set("line_items[0][price_data][product_data][name]", itemTitle);
  params.set("metadata[order_id]", orderId);
  if (buyerEmail) params.set("customer_email", buyerEmail);

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!res.ok) {
    const errText = await res.text();
    return jsonResponse({ error: `Stripe error: ${errText}` }, 502);
  }

  const session = await res.json();
  return jsonResponse({ url: session.url, sessionId: session.id });
}

/** Verifies a Stripe webhook signature using Web Crypto (no Stripe SDK needed). */
async function verifyStripeSignature(payload, signatureHeader, secret) {
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((p) => p.split("="))
  );
  const timestamp = parts.t;
  const expectedSig = parts.v1;
  if (!timestamp || !expectedSig) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signedPayload)
  );
  const computedSig = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return computedSig === expectedSig;
}

async function handleStripeWebhook(request, env) {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    return jsonResponse({ error: "Webhook not configured." }, 501);
  }

  const payload = await request.text();
  const signatureHeader = request.headers.get("stripe-signature");
  if (!signatureHeader) return jsonResponse({ error: "Missing signature." }, 400);

  const valid = await verifyStripeSignature(payload, signatureHeader, env.STRIPE_WEBHOOK_SECRET);
  if (!valid) return jsonResponse({ error: "Invalid signature." }, 400);

  const event = JSON.parse(payload);

  if (event.type === "checkout.session.completed") {
    const orderId = event.data.object.metadata?.order_id;
    if (orderId) {
      // D1 is now the authoritative order record — this is what the
      // dashboard reads from, and it's idempotent (safe if Stripe
      // redelivers the same webhook, which it does sometimes).
      await markOrderPaid(env, orderId);

      // Still update the KV-based club membership stats too — separate
      // concern, unaffected by the order-record rearchitecture.
      const raw = await env.SOUND_COFFEE_KV.get(`pending:${orderId}`);
      if (raw) {
        const payment = JSON.parse(raw);
        if (payment.status === "pending") {
          await confirmPayment(env, payment);
        }
      }
    }
  }

  return jsonResponse({ received: true });
}

// ---------------------------------------------------------------------
// D1 orders — the authoritative order/inventory system. Replaces relying
// on Nostr-relay scanning alone for "what did we sell" — that approach
// had no way to guarantee a given order is only ever counted once.
// ---------------------------------------------------------------------

async function handleCreateOrder(request, env) {
  const body = await request.json();
  const {
    id,
    customerPubkey,
    customerEmail,
    isGuest,
    paymentMethod,
    amountSats,
    amountUsdCents,
    items,
    address,
    phone,
    notes,
    source,
  } = body;

  if (!id || !paymentMethod || !items) {
    return jsonResponse({ error: "Missing required fields." }, 422);
  }

  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO orders (
      id, customer_pubkey, customer_email, is_guest, payment_method, payment_status,
      fulfillment_status, amount_sats, amount_usd_cents, items_json,
      address_line1, address_line2, city, state, zip, country, phone,
      notes, source, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'pending', 'unfulfilled', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING`
  )
    .bind(
      id,
      customerPubkey || null,
      customerEmail || null,
      isGuest ? 1 : 0,
      paymentMethod,
      amountSats || null,
      amountUsdCents || null,
      JSON.stringify(items),
      address?.line1 || null,
      address?.line2 || null,
      address?.city || null,
      address?.state || null,
      address?.zip || null,
      address?.country || null,
      phone || null,
      notes || null,
      source || "soundcoffee.org",
      now,
      now
    )
    .run();

  return jsonResponse({ ok: true, id });
}

async function handleListOrders(request, env) {
  try {
    const url = new URL(request.url);
    const paidOnly = url.searchParams.get("paid") === "1";
    const query = paidOnly
      ? `SELECT * FROM orders WHERE payment_status = 'paid' ORDER BY created_at DESC LIMIT 300`
      : `SELECT * FROM orders ORDER BY created_at DESC LIMIT 300`;
    const { results } = await env.DB.prepare(query).all();
    const orders = results.map((r) => {
      let items = [];
      try {
        items = JSON.parse(r.items_json);
      } catch {
        // Malformed row — don't let it take down every other order too.
      }
      return { ...r, items };
    });
    return jsonResponse({ orders });
  } catch (e) {
    // Surface the real error instead of letting an unhandled exception
    // produce a generic Cloudflare error page — that would break JSON
    // parsing client-side and show up as an unhelpful vague message.
    return jsonResponse({ error: `Failed to load orders: ${e.message}` }, 500);
  }
}

/** Marks an order paid — idempotent, safe to call more than once for the same order. */
async function markOrderPaid(env, orderId) {
  const result = await env.DB.prepare(
    `UPDATE orders SET payment_status = 'paid', updated_at = ? WHERE id = ? AND payment_status != 'paid'`
  )
    .bind(Date.now(), orderId)
    .run();

  // Only commit reservations the first time an order actually transitions
  // to paid — result.meta.changes is 0 if it was already paid, which
  // keeps this safe to call more than once for the same order.
  if (result.meta?.changes > 0) {
    await commitReservationsForOrder(env, orderId);
  }
}

async function handleConfirmOrderD1(request, env) {
  const { id } = await request.json();
  if (!id) return jsonResponse({ error: "Missing id." }, 422);
  await markOrderPaid(env, id);
  return jsonResponse({ ok: true });
}

async function handleMarkShipped(request, env) {
  const { id, trackingNumber, carrier } = await request.json();
  if (!id) return jsonResponse({ error: "Missing id." }, 422);
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE orders SET fulfillment_status = 'shipped', tracking_number = ?, carrier = ?, shipped_at = ?, updated_at = ? WHERE id = ?`
  )
    .bind(trackingNumber || null, carrier || null, now, now, id)
    .run();
  return jsonResponse({ ok: true });
}

// ---------------------------------------------------------------------
// Inventory reservations — reserve → commit (on paid) → naturally expire
// (if abandoned). A reservation only ever holds stock temporarily;
// "sold" is only real once a reservation commits. Available stock is
// always: inventory.stock minus any still-active (unexpired) holds —
// nothing needs a background cleanup job for correctness, an expired
// hold is just excluded from that sum automatically.
// ---------------------------------------------------------------------

const RESERVATION_MINUTES = 15;

/** Called when publishing a listing/variation with a tracked stock count. */
async function handleInitInventory(request, env) {
  const { productCoordinate, title, stock } = await request.json();
  if (!productCoordinate) return jsonResponse({ error: "Missing productCoordinate." }, 422);
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO inventory (product_coordinate, title, stock, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(product_coordinate) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at`
  )
    .bind(productCoordinate, title || null, stock == null ? null : Number(stock), now)
    .run();
  return jsonResponse({ ok: true });
}

async function getAvailableStock(env, productCoordinate) {
  const inv = await env.DB.prepare(
    `SELECT stock FROM inventory WHERE product_coordinate = ?`
  )
    .bind(productCoordinate)
    .first();
  if (!inv || inv.stock == null) return null; // not tracked — treat as unlimited

  const now = Date.now();
  const held = await env.DB.prepare(
    `SELECT COALESCE(SUM(quantity), 0) as total FROM reservations
     WHERE product_coordinate = ? AND status = 'reserved' AND expires_at > ?`
  )
    .bind(productCoordinate, now)
    .first();

  return inv.stock - (held?.total || 0);
}

async function handleReserveInventory(request, env) {
  const { orderId, items } = await request.json();
  if (!orderId || !items || !Array.isArray(items)) {
    return jsonResponse({ error: "Missing orderId or items." }, 422);
  }

  const now = Date.now();
  const expiresAt = now + RESERVATION_MINUTES * 60 * 1000;
  const failures = [];

  for (const item of items) {
    const available = await getAvailableStock(env, item.coordinate);
    if (available !== null && available < item.quantity) {
      failures.push({ coordinate: item.coordinate, available, requested: item.quantity });
    }
  }

  if (failures.length > 0) {
    return jsonResponse({ ok: false, error: "Not enough stock available.", failures }, 409);
  }

  for (const item of items) {
    // Only create a reservation row for tracked products — untracked
    // (unlimited) items don't need one.
    const inv = await env.DB.prepare(
      `SELECT stock FROM inventory WHERE product_coordinate = ?`
    )
      .bind(item.coordinate)
      .first();
    if (!inv || inv.stock == null) continue;

    await env.DB.prepare(
      `INSERT INTO reservations (id, order_id, product_coordinate, quantity, status, expires_at, created_at)
       VALUES (?, ?, ?, ?, 'reserved', ?, ?)`
    )
      .bind(
        `${orderId}:${item.coordinate}`,
        orderId,
        item.coordinate,
        item.quantity,
        expiresAt,
        now
      )
      .run();
  }

  return jsonResponse({ ok: true, expiresAt });
}

/** Called once an order is confirmed paid — converts holds into a real, permanent stock decrease. */
async function commitReservationsForOrder(env, orderId) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM reservations WHERE order_id = ? AND status = 'reserved'`
  )
    .bind(orderId)
    .all();

  for (const r of results) {
    await env.DB.prepare(
      `UPDATE inventory SET stock = MAX(0, stock - ?), updated_at = ? WHERE product_coordinate = ?`
    )
      .bind(r.quantity, Date.now(), r.product_coordinate)
      .run();
    await env.DB.prepare(`UPDATE reservations SET status = 'committed' WHERE id = ?`)
      .bind(r.id)
      .run();
  }
}

/**
 * Decrements inventory for an order detected from another app (Conduit,
 * etc.) — these never go through our reserve/commit flow since the
 * buyer never touched our checkout, so this decrements directly once
 * an order is confirmed paid. Deduped in KV so revisiting the dashboard
 * a hundred times only ever decrements once per real order.
 */
async function handleDecrementInventoryExternal(request, env) {
  const { orderId, items } = await request.json();
  if (!orderId || !Array.isArray(items)) {
    return jsonResponse({ error: "Missing orderId or items." }, 422);
  }

  const dedupKey = `inventory-decremented:${orderId}`;
  if (await env.SOUND_COFFEE_KV.get(dedupKey)) {
    return jsonResponse({ ok: true, skipped: "already decremented" });
  }

  for (const item of items) {
    // MAX(0, ...) — same safety as our own reservation commit path,
    // never let an unexpected quantity push stock negative.
    await env.DB.prepare(
      `UPDATE inventory SET stock = MAX(0, stock - ?), updated_at = ? WHERE product_coordinate = ? AND stock IS NOT NULL`
    )
      .bind(item.quantity || 1, Date.now(), item.coordinate)
      .run();
  }

  await env.SOUND_COFFEE_KV.put(dedupKey, "1", { expirationTtl: 60 * 60 * 24 * 180 });
  return jsonResponse({ ok: true, decremented: true });
}

async function handleGetInventory(request, env) {
  const url = new URL(request.url);
  const coordinate = url.searchParams.get("coordinate");
  if (!coordinate) return jsonResponse({ error: "Missing ?coordinate=" }, 422);
  const available = await getAvailableStock(env, coordinate);
  return jsonResponse({ coordinate, available });
}

// ---------------------------------------------------------------------
// Discount codes — applied at checkout before either payment method
// (Lightning or card) is invoked, so the discount is reflected in
// whichever total actually gets charged either way. Optionally
// restricted to specific npubs; when allowed_npubs is empty, the code
// works for anyone who enters it.
// ---------------------------------------------------------------------

async function handleCreateDiscount(request, env) {
  const body = await request.json();
  const { code, discountType, discountValue, allowedNpubs } = body;

  if (!code || !discountType || discountValue == null) {
    return jsonResponse({ error: "Missing code, discountType, or discountValue." }, 422);
  }
  if (discountType !== "percent" && discountType !== "flat_usd" && discountType !== "flat_sats") {
    return jsonResponse({ error: "discountType must be 'percent', 'flat_usd', or 'flat_sats'." }, 422);
  }

  const normalizedCode = code.trim().toUpperCase();

  await env.DB.prepare(
    `INSERT INTO discount_codes (code, discount_type, discount_value, allowed_npubs, active, uses_count, created_at)
     VALUES (?, ?, ?, ?, 1, 0, ?)
     ON CONFLICT(code) DO UPDATE SET
       discount_type = excluded.discount_type,
       discount_value = excluded.discount_value,
       allowed_npubs = excluded.allowed_npubs,
       active = 1`
  )
    .bind(
      normalizedCode,
      discountType,
      discountValue,
      allowedNpubs && allowedNpubs.length > 0 ? JSON.stringify(allowedNpubs) : null,
      Date.now()
    )
    .run();

  return jsonResponse({ ok: true, code: normalizedCode });
}

async function handleListDiscounts(env) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM discount_codes ORDER BY created_at DESC`
  ).all();
  return jsonResponse({
    discounts: results.map((d) => ({
      ...d,
      allowedNpubs: d.allowed_npubs ? JSON.parse(d.allowed_npubs) : [],
      active: !!d.active,
    })),
  });
}

async function handleDeactivateDiscount(request, env) {
  const { code } = await request.json();
  if (!code) return jsonResponse({ error: "Missing code." }, 422);
  await env.DB.prepare(`UPDATE discount_codes SET active = 0 WHERE code = ?`)
    .bind(code.trim().toUpperCase())
    .run();
  return jsonResponse({ ok: true });
}

/**
 * Validates a discount code against an optional buyer pubkey (hex).
 * Returns the discount to apply, or a clear reason it can't be used —
 * never throws, since checkout needs a clean yes/no either way.
 */
async function handleValidateDiscount(request, env) {
  const { code, pubkey } = await request.json();
  if (!code) return jsonResponse({ valid: false, reason: "No code entered." });

  const normalizedCode = code.trim().toUpperCase();
  const row = await env.DB.prepare(`SELECT * FROM discount_codes WHERE code = ?`)
    .bind(normalizedCode)
    .first();

  if (!row) return jsonResponse({ valid: false, reason: "That code doesn't exist." });
  if (!row.active) return jsonResponse({ valid: false, reason: "That code is no longer active." });

  const allowedNpubs = row.allowed_npubs ? JSON.parse(row.allowed_npubs) : [];
  if (allowedNpubs.length > 0) {
    if (!pubkey || !allowedNpubs.includes(pubkey)) {
      return jsonResponse({ valid: false, reason: "This code isn't valid for your account." });
    }
  }

  return jsonResponse({
    valid: true,
    code: normalizedCode,
    discountType: row.discount_type,
    discountValue: row.discount_value,
  });
}

async function handleRedeemDiscount(request, env) {
  const { code } = await request.json();
  if (!code) return jsonResponse({ error: "Missing code." }, 422);
  await env.DB.prepare(`UPDATE discount_codes SET uses_count = uses_count + 1 WHERE code = ?`)
    .bind(code.trim().toUpperCase())
    .run();
  return jsonResponse({ ok: true });
}

// ---------------------------------------------------------------------
// Podcast feed proxy — replaces rss2json, whose free tier turned out to
// be genuinely unreliable (rejects requests outright above its default
// item count, and rate-limits aggressively even at the default). This
// fetches the real feed XML server-side (no CORS issue — that's only a
// browser restriction) and parses it directly, with no artificial caps
// and no third-party dependency in the request path at all.
// ---------------------------------------------------------------------

function decodeXmlEntities(str) {
  if (!str) return str;
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .trim();
}

function extractTag(block, tagName) {
  // Matches both <tag>...</tag> and self-describing namespaced tags like
  // <content:encoded>...</content:encoded>. Not a full XML parser — just
  // enough to reliably pull standard podcast RSS fields.
  const match = block.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, "i"));
  return match ? decodeXmlEntities(match[1]) : null;
}

function extractAttr(block, tagName, attrName) {
  const match = block.match(new RegExp(`<${tagName}[^>]*\\s${attrName}=["']([^"']*)["']`, "i"));
  return match ? decodeXmlEntities(match[1]) : null;
}

function parsePodcastRss(xml) {
  const channelMatch = xml.match(/<channel[^>]*>([\s\S]*?)<item[^>]*>/i);
  let channelBlock = channelMatch ? channelMatch[1] : "";

  // Podhome (and possibly other hosts) embed <podcast:liveItem> blocks
  // for live-streamed episodes, appearing BEFORE the real channel info
  // and carrying their own <title>/<description>/<guid> tags. Left in
  // place, those would get matched first instead of the show's actual
  // title — strip them out before extracting channel-level fields.
  channelBlock = channelBlock.replace(/<podcast:liveItem[^>]*>[\s\S]*?<\/podcast:liveItem>/gi, "");

  const feedInfo = {
    title: extractTag(channelBlock, "title"),
    description: extractTag(channelBlock, "description"),
    image:
      extractAttr(channelBlock, "itunes:image", "href") ||
      extractTag(channelBlock, "url"), // <image><url>...</url></image>
  };

  const itemBlocks = xml.match(/<item[^>]*>[\s\S]*?<\/item>/gi) || [];
  const items = itemBlocks.map((block) => ({
    title: extractTag(block, "title"),
    link: extractTag(block, "link"),
    pubDate: extractTag(block, "pubDate"),
    description: extractTag(block, "content:encoded") || extractTag(block, "description"),
    audioUrl: extractAttr(block, "enclosure", "url"),
    guid: extractTag(block, "guid"),
    // Podcast Namespace chapters — a JSON file the host (PodHome, etc.)
    // generates and links per-episode, not embedded content itself.
    // Spec uses a "url" attribute here, not "href" — confirmed against
    // the actual podcast-namespace docs, not assumed.
    chaptersUrl: extractAttr(block, "podcast:chapters", "url"),
    // Per-episode artwork — itunes:image uses "href", confirmed against
    // the actual iTunes/Podcast Standards spec docs (different
    // attribute name than podcast:chapters above, worth not assuming
    // it'd be the same).
    image: extractAttr(block, "itunes:image", "href"),
  }));

  return { feedInfo, items };
}

async function handlePodcastFeed(request, env) {
  const url = new URL(request.url);
  const feedUrl = url.searchParams.get("url");
  if (!feedUrl) return jsonResponse({ error: "Missing ?url=" }, 422);

  try {
    const res = await fetch(feedUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SoundCoffeeBot/1.0)" },
    });
    if (!res.ok) {
      return jsonResponse({ error: `Feed returned ${res.status}` }, 502);
    }
    const xml = await res.text();
    const { feedInfo, items } = parsePodcastRss(xml);
    return jsonResponse({ status: "ok", feedInfo, items });
  } catch (e) {
    return jsonResponse({ error: e.message }, 502);
  }
}

/**
 * Proxies a Podcast Namespace chapters JSON file — same CORS reasoning
 * as the feed proxy above, these are hosted wherever the podcast host
 * (PodHome, etc.) puts them, not on our own domain.
 */
async function handlePodcastChapters(request, env) {
  const url = new URL(request.url);
  const chaptersUrl = url.searchParams.get("url");
  if (!chaptersUrl) return jsonResponse({ error: "Missing ?url=" }, 422);

  try {
    const res = await fetch(chaptersUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SoundCoffeeBot/1.0)" },
    });
    if (!res.ok) {
      return jsonResponse({ error: `Chapters file returned ${res.status}` }, 502);
    }
    const data = await res.json();
    // Spec shape: { version, chapters: [{ startTime, title, img?, url? }] }
    // — passed through as-is, just proxied for CORS, not reshaped.
    return jsonResponse(data);
  } catch (e) {
    return jsonResponse({ error: e.message }, 502);
  }
}

// ---------------------------------------------------------------------
// Radio podcast curation — the site's one curated radio feed, shown in
// Listening Lair alongside Sound Coffee's own show. Admin-only to add
// or remove; not a public, guest-built queue.
// ---------------------------------------------------------------------

/**
 * Fetches and validates an RSS feed to preview before actually adding
 * it — confirms it's real and working, and returns its own declared
 * name/image so the admin doesn't have to type those in by hand.
 */
async function handlePreviewRadioFeed(request, env) {
  const url = new URL(request.url);
  const feedUrl = url.searchParams.get("url");
  if (!feedUrl) return jsonResponse({ error: "Missing ?url=" }, 422);

  try {
    const res = await fetch(feedUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SoundCoffeeBot/1.0)" },
    });
    if (!res.ok) return jsonResponse({ error: `Feed returned ${res.status}` }, 502);
    const xml = await res.text();
    const { feedInfo, items } = parsePodcastRss(xml);
    if (!items || items.length === 0) {
      return jsonResponse({ error: "That feed has no episodes." }, 422);
    }
    return jsonResponse({
      name: feedInfo?.title || "Untitled podcast",
      image: feedInfo?.image || null,
      recentEpisodes: items.slice(0, 5).map((i) => ({
        guid: i.guid,
        title: i.title,
        audioUrl: i.audioUrl || null,
        chaptersUrl: i.chaptersUrl || null,
        image: i.image || null,
      })),
    });
  } catch (e) {
    return jsonResponse({ error: e.message }, 502);
  }
}

async function handleAddRadioPodcast(request, env) {
  const { feedUrl, name, image, recipientPubkey } = await request.json();
  if (!feedUrl || !name) {
    return jsonResponse({ error: "Missing feedUrl or name." }, 422);
  }
  await env.DB.prepare(
    `INSERT INTO radio_podcasts (feed_url, name, recipient_pubkey, image, added_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(feed_url) DO UPDATE SET name = excluded.name, recipient_pubkey = excluded.recipient_pubkey, image = excluded.image`
  )
    .bind(feedUrl, name, recipientPubkey || null, image || null, Date.now())
    .run();
  return jsonResponse({ ok: true });
}

async function handleListRadioPodcasts(env) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM radio_podcasts ORDER BY added_at ASC`
  ).all();
  return jsonResponse({
    podcasts: results.map((p) => ({
      feedUrl: p.feed_url,
      name: p.name,
      recipientPubkey: p.recipient_pubkey,
      image: p.image,
    })),
  });
}

async function handleRemoveRadioPodcast(request, env) {
  const { feedUrl } = await request.json();
  if (!feedUrl) return jsonResponse({ error: "Missing feedUrl." }, 422);
  await env.DB.prepare(`DELETE FROM radio_podcasts WHERE feed_url = ?`).bind(feedUrl).run();
  return jsonResponse({ ok: true });
}

/**
 * Adds one specific episode to the featured playlist — and, per the
 * explicit requirement, also adds its parent show to radio_podcasts
 * if it isn't already curated there, so the full show becomes
 * browsable too, not just this one episode.
 */
async function handleAddPlaylistEpisode(request, env) {
  const { guid, feedUrl, title, audioUrl, image, chaptersUrl, feedName, recipientPubkey } =
    await request.json();
  if (!guid || !feedUrl || !title) {
    return jsonResponse({ error: "Missing guid, feedUrl, or title." }, 422);
  }

  await env.DB.prepare(
    `INSERT INTO radio_playlist_episodes (guid, feed_url, title, audio_url, image, chapters_url, feed_name, recipient_pubkey, added_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(guid) DO UPDATE SET title = excluded.title, audio_url = excluded.audio_url, image = excluded.image, chapters_url = excluded.chapters_url`
  )
    .bind(guid, feedUrl, title, audioUrl || null, image || null, chaptersUrl || null, feedName || null, recipientPubkey || null, Date.now())
    .run();

  const existingShow = await env.DB.prepare(`SELECT feed_url FROM radio_podcasts WHERE feed_url = ?`)
    .bind(feedUrl)
    .first();
  if (!existingShow) {
    await env.DB.prepare(
      `INSERT INTO radio_podcasts (feed_url, name, recipient_pubkey, image, added_at) VALUES (?, ?, ?, ?, ?)`
    )
      .bind(feedUrl, feedName || "Untitled podcast", recipientPubkey || null, image || null, Date.now())
      .run();
  }

  return jsonResponse({ ok: true });
}

async function handleListPlaylistEpisodes(env) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM radio_playlist_episodes ORDER BY added_at DESC`
  ).all();
  return jsonResponse({
    episodes: results.map((e) => ({
      guid: e.guid,
      feedUrl: e.feed_url,
      title: e.title,
      audioUrl: e.audio_url,
      image: e.image,
      chaptersUrl: e.chapters_url,
      feedName: e.feed_name,
      recipientPubkey: e.recipient_pubkey,
    })),
  });
}

async function handleRemovePlaylistEpisode(request, env) {
  const { guid } = await request.json();
  if (!guid) return jsonResponse({ error: "Missing guid." }, 422);
  await env.DB.prepare(`DELETE FROM radio_playlist_episodes WHERE guid = ?`).bind(guid).run();
  return jsonResponse({ ok: true });
}

/**
 * Direct diagnostic — visit this in a browser to immediately see
 * exactly why email isn't working, instead of placing test orders and
 * checking a separate dashboard. Reports precisely which secret (if
 * any) is missing, or the exact error Resend itself returned.
 */
/**
 * Direct diagnostic for Stripe config — same reasoning as the email
 * one above. Detects test vs live mode directly from the key's own
 * prefix (no guessing needed), and makes one safe, read-only API call
 * to confirm the key actually works, without touching anything.
 */
async function handleTestStripeConfig(env) {
  const diag = {
    stripeSecretKeyPresent: !!env.STRIPE_SECRET_KEY,
    stripeSecretKeyMode: env.STRIPE_SECRET_KEY?.startsWith("sk_live_")
      ? "LIVE"
      : env.STRIPE_SECRET_KEY?.startsWith("sk_test_")
      ? "TEST"
      : env.STRIPE_SECRET_KEY
      ? "UNRECOGNIZED FORMAT"
      : null,
    stripeWebhookSecretPresent: !!env.STRIPE_WEBHOOK_SECRET,
  };

  if (!env.STRIPE_SECRET_KEY) {
    return jsonResponse({
      ...diag,
      result: "FAILED — STRIPE_SECRET_KEY is not visible to this Worker at runtime.",
    });
  }
  if (!env.STRIPE_WEBHOOK_SECRET) {
    return jsonResponse({
      ...diag,
      result: "PARTIAL — secret key is visible, but STRIPE_WEBHOOK_SECRET is missing. Checkout could work, but payment confirmations never will without this.",
    });
  }

  try {
    const res = await fetch("https://api.stripe.com/v1/account", {
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
    });
    if (!res.ok) {
      const body = await res.text();
      return jsonResponse({
        ...diag,
        result: `FAILED — Stripe rejected this key: ${res.status} ${body.slice(0, 200)}`,
      });
    }
    const account = await res.json();
    return jsonResponse({
      ...diag,
      result: `SUCCESS — key is valid and working, in ${diag.stripeSecretKeyMode} mode. Account: ${account.id}, charges enabled: ${account.charges_enabled}.`,
    });
  } catch (e) {
    return jsonResponse({ ...diag, result: `FAILED — couldn't reach Stripe: ${e.message}` });
  }
}

async function handleTestEmail(env) {
  const diag = {
    resendApiKeyPresent: !!env.RESEND_API_KEY,
    resendApiKeyLength: env.RESEND_API_KEY?.length || 0,
    adminEmailPresent: !!env.ADMIN_EMAIL,
    adminEmailValue: env.ADMIN_EMAIL || null,
  };

  if (!env.RESEND_API_KEY) {
    return jsonResponse({
      ...diag,
      result: "FAILED — RESEND_API_KEY is not visible to this Worker at runtime. Either it's not saved, saved under a slightly different name, or saved somewhere this Worker doesn't read from.",
    });
  }
  if (!env.ADMIN_EMAIL) {
    return jsonResponse({
      ...diag,
      result: "FAILED — ADMIN_EMAIL is not visible to this Worker at runtime, same issue as above.",
    });
  }

  try {
    await sendEmail(env, {
      to: env.ADMIN_EMAIL,
      subject: "Sound Coffee — test email",
      text: `This is a direct test, sent at ${new Date().toISOString()}. If you're reading this, email is genuinely working.`,
    });
    return jsonResponse({ ...diag, result: "SUCCESS — check the inbox now." });
  } catch (e) {
    return jsonResponse({
      ...diag,
      result: `FAILED — both secrets are visible, but Resend itself rejected the request: ${e.message}`,
    });
  }
}

async function handleGetRelays(env) {
  const relays = await getZapSearchRelays(env);
  return jsonResponse({ relays });
}

/**
 * Diagnostic: scans all zap receipts to Sound Coffee (full history, not
 * just the usual 7-day window) and reports what's actually in their i
 * tags — not just whether they match our expected episode prefix. This
 * is how we actually find out whether other apps use a different
 * convention, rather than guessing at it the way we nearly did with
 * Conduit's order format before checking real data.
 */
async function handleDiagnoseEpisodeZaps(env) {
  const pool = new SimplePool();
  const zapSearchRelays = await getZapSearchRelays(env);
  const diag = {
    totalReceipts: 0,
    noDescriptionTag: 0,
    malformedZapRequest: 0,
    noITagAtAll: 0,
    iTagMatchesOurPrefix: 0,
    iTagPresentButDifferent: [],
  };

  try {
    const receipts = await pool.querySync(zapSearchRelays, {
      kinds: [9735],
      "#p": [SOUND_COFFEE_PUBKEY],
    });
    diag.totalReceipts = receipts.length;

    for (const receipt of receipts) {
      const descriptionTag = receipt.tags.find((t) => t[0] === "description");
      if (!descriptionTag) {
        diag.noDescriptionTag++;
        continue;
      }
      let zapRequest;
      try {
        zapRequest = JSON.parse(descriptionTag[1]);
      } catch {
        diag.malformedZapRequest++;
        continue;
      }

      const iTags = zapRequest.tags.filter((t) => t[0] === "i");
      if (iTags.length === 0) {
        diag.noITagAtAll++;
        continue;
      }

      const matching = iTags.find((t) => t[1]?.startsWith(EPISODE_I_PREFIX));
      if (matching) {
        diag.iTagMatchesOurPrefix++;
      } else if (diag.iTagPresentButDifferent.length < 10) {
        // Real values, not guesses — this is what tells us the actual
        // convention other apps are using, if it differs from ours.
        diag.iTagPresentButDifferent.push({
          iTagValues: iTags.map((t) => t[1]),
          kTagValues: zapRequest.tags.filter((t) => t[0] === "k").map((t) => t[1]),
          eTag: zapRequest.tags.find((t) => t[0] === "e")?.[1] || null,
          content: (zapRequest.content || "").slice(0, 60),
        });
      }
    }
  } finally {
    pool.close(zapSearchRelays);
  }

  return jsonResponse(diag);
}

async function handleFetch(request, env) {
  const url = new URL(request.url);

  if (request.method === "POST" && url.pathname === "/api/pending-payment") {
    return handlePendingPayment(request, env);
  }
  if (request.method === "POST" && url.pathname === "/api/confirm-payment") {
    return handleConfirmPayment(request, env);
  }
  if (request.method === "POST" && url.pathname === "/api/branta/verify") {
    return handleBrantaVerify(request, env);
  }
  if (request.method === "POST" && url.pathname === "/api/notify-order") {
    return handleNotifyOrder(request, env);
  }
  if (request.method === "POST" && url.pathname === "/api/notify-order-detected") {
    return handleNotifyOrderDetected(request, env);
  }
  if (request.method === "POST" && url.pathname === "/api/notify-shipped") {
    return handleNotifyShipped(request, env);
  }
  if (request.method === "POST" && url.pathname === "/api/create-checkout-session") {
    return handleCreateCheckoutSession(request, env);
  }
  if (request.method === "POST" && url.pathname === "/api/stripe-webhook") {
    return handleStripeWebhook(request, env);
  }
  if (request.method === "GET" && url.pathname === "/api/stats") {
    return handleStats(request, env);
  }
  if (request.method === "GET" && url.pathname === "/api/episode-zaps") {
    return handleEpisodeZaps(request, env);
  }
  if (request.method === "GET" && url.pathname === "/api/top-episodes") {
    return handleTopEpisodes(request, env);
  }
  if (request.method === "POST" && url.pathname === "/api/orders") {
    return handleCreateOrder(request, env);
  }
  if (request.method === "GET" && url.pathname === "/api/orders") {
    return handleListOrders(request, env);
  }
  if (request.method === "POST" && url.pathname === "/api/orders/confirm") {
    return handleConfirmOrderD1(request, env);
  }
  if (request.method === "POST" && url.pathname === "/api/orders/ship") {
    return handleMarkShipped(request, env);
  }
  if (request.method === "POST" && url.pathname === "/api/inventory/init") {
    return handleInitInventory(request, env);
  }
  if (request.method === "POST" && url.pathname === "/api/inventory/reserve") {
    return handleReserveInventory(request, env);
  }
  if (request.method === "POST" && url.pathname === "/api/inventory/decrement-external") {
    return handleDecrementInventoryExternal(request, env);
  }
  if (request.method === "GET" && url.pathname === "/api/inventory") {
    return handleGetInventory(request, env);
  }
  if (request.method === "POST" && url.pathname === "/api/discounts") {
    return handleCreateDiscount(request, env);
  }
  if (request.method === "GET" && url.pathname === "/api/discounts") {
    return handleListDiscounts(env);
  }
  if (request.method === "POST" && url.pathname === "/api/discounts/deactivate") {
    return handleDeactivateDiscount(request, env);
  }
  if (request.method === "POST" && url.pathname === "/api/discounts/validate") {
    return handleValidateDiscount(request, env);
  }
  if (request.method === "POST" && url.pathname === "/api/discounts/redeem") {
    return handleRedeemDiscount(request, env);
  }
  if (request.method === "GET" && url.pathname === "/api/podcast-feed") {
    return handlePodcastFeed(request, env);
  }
  if (request.method === "GET" && url.pathname === "/api/podcast-chapters") {
    return handlePodcastChapters(request, env);
  }
  if (request.method === "GET" && url.pathname === "/api/radio-podcasts/preview") {
    return handlePreviewRadioFeed(request, env);
  }
  if (request.method === "POST" && url.pathname === "/api/radio-podcasts") {
    return handleAddRadioPodcast(request, env);
  }
  if (request.method === "GET" && url.pathname === "/api/radio-podcasts") {
    return handleListRadioPodcasts(env);
  }
  if (request.method === "POST" && url.pathname === "/api/radio-podcasts/remove") {
    return handleRemoveRadioPodcast(request, env);
  }
  if (request.method === "POST" && url.pathname === "/api/radio-playlist") {
    return handleAddPlaylistEpisode(request, env);
  }
  if (request.method === "GET" && url.pathname === "/api/radio-playlist") {
    return handleListPlaylistEpisodes(env);
  }
  if (request.method === "POST" && url.pathname === "/api/radio-playlist/remove") {
    return handleRemovePlaylistEpisode(request, env);
  }
  if (request.method === "GET" && url.pathname === "/api/club-members") {
    return handleClubMembers(env);
  }
  if (request.method === "GET" && url.pathname === "/api/relays") {
    return handleGetRelays(env);
  }
  if (request.method === "GET" && url.pathname === "/api/test-email") {
    return handleTestEmail(env);
  }
  if (request.method === "GET" && url.pathname === "/api/test-stripe-config") {
    return handleTestStripeConfig(env);
  }
  if (request.method === "GET" && url.pathname === "/api/diagnose-episode-zaps") {
    return handleDiagnoseEpisodeZaps(env);
  }
  if (request.method === "POST" && url.pathname === "/api/admin/recompute-stats") {
    return handleRecomputeStats(env);
  }

  return new Response("Not found", { status: 404 });
}

// ---------------------------------------------------------------------
// Scheduled job
// ---------------------------------------------------------------------

/** Primary path: check every pending payment we registered ourselves. */
/** Marks a pending payment confirmed and records it toward stats/episode totals. */
async function confirmPayment(env, payment) {
  payment.status = "confirmed";
  await env.SOUND_COFFEE_KV.put(`pending:${payment.id}`, JSON.stringify(payment));

  // D1 is the authoritative order record for purchases (not zaps, those
  // aren't orders). Idempotent — safe even if this runs more than once
  // for the same payment.
  if (payment.type === "purchase") {
    await markOrderPaid(env, payment.id);
  }

  const sourceId = payment.type === "zap" ? `zap:${payment.id}` : `purchase:${payment.id}`;
  await recordConfirmedPayment(env, {
    pubkey: payment.pubkey,
    type: payment.type,
    amountSats: payment.amountSats,
    sourceId,
  });
  if (payment.type === "zap" && payment.episodeGuid) {
    await recordEpisodeZap(env, {
      episodeGuid: payment.episodeGuid,
      amountSats: payment.amountSats,
      comment: payment.comment,
      zapperPubkey: payment.pubkey,
      sourceId,
    });
  }
}

async function handleConfirmPayment(request, env) {
  const { id } = await request.json();
  if (!id) return jsonResponse({ error: "Missing id." }, 422);

  const raw = await env.SOUND_COFFEE_KV.get(`pending:${id}`);
  if (!raw) return jsonResponse({ error: "No such pending payment." }, 404);

  const payment = JSON.parse(raw);
  if (payment.status === "pending") {
    // Self-reported by the buyer, same trust level as the NIP-17 receipt
    // DM already relies on — not cryptographic proof, but the honest
    // fallback for providers that don't support automatic verification.
    await confirmPayment(env, payment);
  }
  return jsonResponse({ ok: true });
}

async function pollPendingPayments(env) {
  const list = await env.SOUND_COFFEE_KV.list({ prefix: "pending:" });

  for (const key of list.keys) {
    const raw = await env.SOUND_COFFEE_KV.get(key.name);
    if (!raw) continue;
    const payment = JSON.parse(raw);
    if (payment.status !== "pending" || !payment.verifyUrl) continue;

    try {
      const res = await fetch(payment.verifyUrl);
      const data = await res.json();
      if (data.settled) {
        await confirmPayment(env, payment);
      }
    } catch {
      // provider unreachable this run — try again next run
    }
  }
}

/**
 * Bonus path: also watch relays directly for zap receipts to the show,
 * in case someone boosts through a different Nostr client entirely
 * (not through our site's zap button, so we'd have no pending record
 * for it). Whatever this finds gets folded into the same stats.
 */
async function pollZapReceiptsFromRelays(env) {
  const pool = new SimplePool();
  const zapSearchRelays = await getZapSearchRelays(env);
  try {
    const receipts = await pool.querySync(zapSearchRelays, {
      kinds: [9735],
      "#p": [SOUND_COFFEE_PUBKEY],
      since: Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 7,
    });

    for (const receipt of receipts) {
      try {
        const descriptionTag = receipt.tags.find((t) => t[0] === "description");
        if (!descriptionTag) continue;
        const zapRequest = JSON.parse(descriptionTag[1]);
        const amountTag = zapRequest.tags.find((t) => t[0] === "amount");
        if (!amountTag) continue;
        const amountSats = Math.floor(Number(amountTag[1]) / 1000);

        // Use the ORIGINAL zap request's id, not the receipt's own id.
        // A zap sent through our site is registered under this same id
        // via pollPendingPayments — using it here too means both paths
        // agree it's the same zap and the idempotency check in
        // recordConfirmedPayment actually catches the overlap, instead
        // of double-counting it as two different payments.
        await recordConfirmedPayment(env, {
          pubkey: zapRequest.pubkey,
          type: "zap",
          amountSats,
          sourceId: `zap:${zapRequest.id}`,
        });

        // Recognizes both the current spec-correct prefix and our own
        // earlier (pre-fix) convention — a handful of zaps sent while
        // we were still using the old format shouldn't just become
        // permanently orphaned data.
        const iTag = zapRequest.tags.find(
          (t) =>
            t[0] === "i" &&
            (t[1]?.startsWith(EPISODE_I_PREFIX) || t[1]?.startsWith(LEGACY_EPISODE_I_PREFIX))
        );
        if (iTag) {
          const episodeGuid = iTag[1].startsWith(EPISODE_I_PREFIX)
            ? iTag[1].slice(EPISODE_I_PREFIX.length)
            : iTag[1].slice(LEGACY_EPISODE_I_PREFIX.length);
          await recordEpisodeZap(env, {
            episodeGuid,
            amountSats,
            comment: zapRequest.content,
            zapperPubkey: zapRequest.pubkey,
            sourceId: `zap:${zapRequest.id}`,
          });
        }
      } catch {
        // malformed receipt — skip it
      }
    }
  } finally {
    pool.close(zapSearchRelays);
  }
}

/**
 * Wider-ecosystem path: per NIP-73 (used by Fountain, BoostMeBitch, and
 * indexers like OnlyBoosts), a "boost note" is a kind 1 event tagged
 * with the show's real Podcast Index GUID plus a payment signal (an
 * amount tag, a zap receipt reference, or a "boostagram" t-tag). This
 * scans for those directly — from ANY npub, not just people who zapped
 * through our own site — so a boost sent via Fountain or any other app
 * that publishes to Nostr shows up here too, not only ones sent through
 * our own zap button.
 */
async function pollEcosystemBoostNotes(env) {
  const pool = new SimplePool();
  const zapSearchRelays = await getZapSearchRelays(env);
  try {
    const notes = await pool.querySync(zapSearchRelays, {
      kinds: [1],
      "#i": [SHOW_I_TAG],
      since: Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 7,
    });

    for (const note of notes) {
      try {
        const amountTag = note.tags.find((t) => t[0] === "amount");
        const hasBoostagramTag = note.tags.some(
          (t) => t[0] === "t" && t[1]?.toLowerCase() === "boostagram"
        );
        // Require some evidence of payment, same rule OnlyBoosts uses —
        // a bare show/episode reference with no payment signal isn't a
        // boost, it's just a note that happens to mention the show.
        if (!amountTag && !hasBoostagramTag) continue;

        const amountSats = amountTag ? Math.floor(Number(amountTag[1]) / 1000) : 0;
        if (amountSats <= 0 && !hasBoostagramTag) continue;

        const episodeGuid = episodeGuidFromTags(note.tags);
        const sourceId = `ecosystem:${note.id}`;

        // Deliberately NOT calling recordConfirmedPayment here — a boost
        // note from elsewhere on Nostr is, in OnlyBoosts' own words, "a
        // claim, not a receipt": nothing cryptographically ties it to a
        // real settled payment the way our own site's zap receipts and
        // verified invoices are. Granting club membership off an
        // unverifiable claim would be a real integrity gap (anyone could
        // publish a fake note claiming a huge boost). This still updates
        // the episode's public zap/comment feed, which is display-only
        // and low-stakes either way.
        if (episodeGuid && (amountSats > 0 || hasBoostagramTag)) {
          await recordEpisodeZap(env, {
            episodeGuid,
            amountSats,
            comment: note.content,
            zapperPubkey: note.pubkey,
            sourceId,
          });
        }
      } catch {
        // malformed note — skip it
      }
    }
  } finally {
    pool.close(zapSearchRelays);
  }
}

function episodeGuidFromTags(tags) {
  const iTag = tags.find(
    (t) =>
      t[0] === "i" &&
      (t[1]?.startsWith(EPISODE_I_PREFIX) || t[1]?.startsWith(LEGACY_EPISODE_I_PREFIX))
  );
  if (!iTag) return null;
  return iTag[1].startsWith(EPISODE_I_PREFIX)
    ? iTag[1].slice(EPISODE_I_PREFIX.length)
    : iTag[1].slice(LEGACY_EPISODE_I_PREFIX.length);
}

async function handleScheduled(env) {
  await pollPendingPayments(env);
  await pollZapReceiptsFromRelays(env);
  await pollEcosystemBoostNotes(env);
}

// ---------------------------------------------------------------------

export default {
  fetch: handleFetch,
  scheduled: (event, env, ctx) => ctx.waitUntil(handleScheduled(env)),
};
// build marker: 2026-08-25T17:01:42Z
