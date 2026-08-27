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

const SOUND_COFFEE_PUBKEY =
  "3e8220285e34b7dd2212b6eb62648c4e2cffdaab2f740daeeb50405e9883f45d";

// The show's real Podcast Index GUID — see src/lib/identities.js for
// where this comes from and why it matters for finding boosts sent
// through the wider Podcasting 2.0 / Nostr ecosystem, not just our site.
const SOUND_COFFEE_SHOW_GUID = "de47e794-c0a3-4bb4-8712-cce1e4566b7e";
const SHOW_I_TAG = `podcast:guid:${SOUND_COFFEE_SHOW_GUID}`;
const EPISODE_I_PREFIX = "podcast:item:guid:";

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
  const { id, type, pubkey, sellerPubkey, invoice, verifyUrl, amountSats, episodeGuid, comment } = body;

  if (!id || !type || !pubkey || !invoice || !amountSats) {
    return jsonResponse({ error: "Missing required fields." }, 422);
  }
  if (type !== "zap" && type !== "purchase") {
    return jsonResponse({ error: "type must be 'zap' or 'purchase'." }, 422);
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

async function sendEmail(env, { to, subject, text }) {
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
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  return { sent: true };
}

async function handleNotifyOrder(request, env) {
  const body = await request.json();
  const { orderId, itemTitle, quantity, amountSats, buyerNpub, buyerEmail, address, notes } = body;

  if (!orderId || !itemTitle) {
    return jsonResponse({ error: "Missing required fields." }, 422);
  }

  const summary = [
    `New order: ${itemTitle} x${quantity || 1}`,
    `Order ID: ${orderId}`,
    `Amount: ${amountSats} sats`,
    buyerNpub ? `Buyer npub: ${buyerNpub}` : null,
    address ? `Shipping address:\n${address}` : null,
    notes ? `Notes: ${notes}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  const results = {};

  if (env.ADMIN_EMAIL) {
    try {
      results.admin = await sendEmail(env, {
        to: env.ADMIN_EMAIL,
        subject: `☕ New order: ${itemTitle}`,
        text: summary,
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
      });
    } catch (e) {
      results.buyer = { error: e.message };
    }
  }

  return jsonResponse({ ok: true, results });
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
  try {
    const receipts = await pool.querySync(DEFAULT_RELAYS, {
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
    pool.close(DEFAULT_RELAYS);
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
  // date), only assigning a new one if they're newly qualifying.
  const now = Date.now();
  const results = [];
  for (const entry of byPubkey.values()) {
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

  if (!orderId || !itemTitle || !amountUsdCents) {
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
  await env.DB.prepare(
    `UPDATE orders SET payment_status = 'paid', updated_at = ? WHERE id = ? AND payment_status != 'paid'`
  )
    .bind(Date.now(), orderId)
    .run();
}

async function handleConfirmOrderD1(request, env) {
  const { id } = await request.json();
  if (!id) return jsonResponse({ error: "Missing id." }, 422);
  await markOrderPaid(env, id);
  return jsonResponse({ ok: true });
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
  if (request.method === "GET" && url.pathname === "/api/club-members") {
    return handleClubMembers(env);
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
  try {
    const receipts = await pool.querySync(DEFAULT_RELAYS, {
      kinds: [9735],
      "#p": [SOUND_COFFEE_PUBKEY],
      since: Math.floor(Date.now() / 1000) - 60 * 60 * 24,
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

        const iTag = zapRequest.tags.find(
          (t) => t[0] === "i" && t[1]?.startsWith(EPISODE_I_PREFIX)
        );
        if (iTag) {
          const episodeGuid = iTag[1].slice(EPISODE_I_PREFIX.length);
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
    pool.close(DEFAULT_RELAYS);
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
  try {
    const notes = await pool.querySync(DEFAULT_RELAYS, {
      kinds: [1],
      "#i": [SHOW_I_TAG],
      since: Math.floor(Date.now() / 1000) - 60 * 60 * 24,
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
    pool.close(DEFAULT_RELAYS);
  }
}

function episodeGuidFromTags(tags) {
  const iTag = tags.find((t) => t[0] === "i" && t[1]?.startsWith(EPISODE_I_PREFIX));
  return iTag ? iTag[1].slice(EPISODE_I_PREFIX.length) : null;
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
