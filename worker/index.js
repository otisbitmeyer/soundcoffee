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

async function handleFetch(request, env) {
  const url = new URL(request.url);

  if (request.method === "POST" && url.pathname === "/api/pending-payment") {
    return handlePendingPayment(request, env);
  }
  if (request.method === "POST" && url.pathname === "/api/branta/verify") {
    return handleBrantaVerify(request, env);
  }
  if (request.method === "POST" && url.pathname === "/api/notify-order") {
    return handleNotifyOrder(request, env);
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
        payment.status = "confirmed";
        await env.SOUND_COFFEE_KV.put(key.name, JSON.stringify(payment));
        // Use a namespaced-by-type source id so this can never collide
        // with the relay-scan path below for a purchase, while matching
        // it exactly for a zap (both derive from the same zap request id).
        const sourceId =
          payment.type === "zap" ? `zap:${payment.id}` : `purchase:${payment.id}`;
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

        const iTag = zapRequest.tags.find((t) => t[0] === "i");
        if (iTag && iTag[1]?.startsWith("podcast:episode:")) {
          const episodeGuid = iTag[1].slice("podcast:episode:".length);
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

async function handleScheduled(env) {
  await pollPendingPayments(env);
  await pollZapReceiptsFromRelays(env);
}

// ---------------------------------------------------------------------

export default {
  fetch: handleFetch,
  scheduled: (event, env, ctx) => ctx.waitUntil(handleScheduled(env)),
};
// build marker: 2026-08-25T17:01:42Z
