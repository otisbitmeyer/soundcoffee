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

// ---------------------------------------------------------------------
// HTTP API
// ---------------------------------------------------------------------

async function handlePendingPayment(request, env) {
  const body = await request.json();
  const { id, type, pubkey, sellerPubkey, invoice, verifyUrl, amountSats } = body;

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

async function handleFetch(request, env) {
  const url = new URL(request.url);

  if (request.method === "POST" && url.pathname === "/api/pending-payment") {
    return handlePendingPayment(request, env);
  }
  if (request.method === "POST" && url.pathname === "/api/branta/verify") {
    return handleBrantaVerify(request, env);
  }
  if (request.method === "GET" && url.pathname === "/api/stats") {
    return handleStats(request, env);
  }
  if (request.method === "GET" && url.pathname === "/api/club-members") {
    return handleClubMembers(env);
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
        await recordConfirmedPayment(env, {
          pubkey: payment.pubkey,
          type: payment.type,
          amountSats: payment.amountSats,
          sourceId: `pending:${payment.id}`,
        });
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

        await recordConfirmedPayment(env, {
          pubkey: zapRequest.pubkey,
          type: "zap",
          amountSats,
          sourceId: `receipt:${receipt.id}`,
        });
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
