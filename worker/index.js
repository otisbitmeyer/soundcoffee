// Sound Coffee background worker.
//
// Runs alongside the static site (same Cloudflare Workers project) and
// does two jobs a static site can't do on its own:
//
//   1. HTTP API (fetch handler) — a couple of small endpoints the
//      checkout flow calls: registering a pending order, and proxying
//      to Branta (which needs a secret API key that can never live in
//      client-side code).
//
//   2. Scheduled job (cron) — runs on a timer, watches Nostr relays for
//      qualifying zap boosts, and checks pending Lightning invoices for
//      settlement. Maintains the Coffee Club membership list.
//
// NOTE: this hasn't been run against real Cloudflare infrastructure yet
// (built without direct access to deploy/test it) — treat the first
// deploy as a debugging session, not a sure thing. See WORKER-SETUP.md
// for what needs to be configured before this works.

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
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------
// HTTP API
// ---------------------------------------------------------------------

async function handlePendingOrder(request, env) {
  const body = await request.json();
  const { orderId, buyerPubkey, sellerPubkey, invoice, verifyUrl, amountSats } = body;

  if (!orderId || !buyerPubkey || !invoice || !amountSats) {
    return jsonResponse({ error: "Missing required fields." }, 422);
  }

  await env.SOUND_COFFEE_KV.put(
    `order:${orderId}`,
    JSON.stringify({
      orderId,
      buyerPubkey,
      sellerPubkey,
      invoice,
      verifyUrl: verifyUrl || null,
      amountSats,
      status: "pending",
      createdAt: Date.now(),
    }),
    { expirationTtl: 60 * 60 * 24 * 30 } // clean up after 30 days regardless
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
      ttl: 3600, // invoice-verification window, 1 hour
      description: "Sound Coffee order",
    }),
  });

  if (!brantaRes.ok) {
    const errText = await brantaRes.text();
    return jsonResponse({ error: `Branta error: ${errText}` }, 502);
  }

  // Best-effort verify link — confirm this matches Branta's actual URL
  // format once real API access is available; their docs describe this
  // page but don't spell out the exact query param name.
  const verifyLink = `https://guardrail.branta.pro/v1/verify/address?payment=${encodeURIComponent(invoice)}`;
  return jsonResponse({ verifyLink });
}

async function handleClubMembers(env) {
  const list = await env.SOUND_COFFEE_KV.list({ prefix: "member:" });
  const members = await Promise.all(
    list.keys.map(async (k) => JSON.parse(await env.SOUND_COFFEE_KV.get(k.name)))
  );
  return jsonResponse({ members });
}

async function handleFetch(request, env) {
  const url = new URL(request.url);

  if (request.method === "POST" && url.pathname === "/api/pending-order") {
    return handlePendingOrder(request, env);
  }
  if (request.method === "POST" && url.pathname === "/api/branta/verify") {
    return handleBrantaVerify(request, env);
  }
  if (request.method === "GET" && url.pathname === "/api/club-members") {
    return handleClubMembers(env);
  }

  return new Response("Not found", { status: 404 });
}

// ---------------------------------------------------------------------
// Scheduled job
// ---------------------------------------------------------------------

async function addMember(env, pubkey, via, detail) {
  const key = `member:${pubkey}`;
  const existing = await env.SOUND_COFFEE_KV.get(key);
  if (existing) return; // already a member, nothing to do

  await env.SOUND_COFFEE_KV.put(
    key,
    JSON.stringify({ pubkey, via, detail, joinedAt: Date.now() })
  );
}

/** Checks relays for zap receipts to the show that meet the boost threshold. */
async function pollZapBoosts(env) {
  const pool = new SimplePool();
  try {
    const receipts = await pool.querySync(DEFAULT_RELAYS, {
      kinds: [9735],
      "#p": [SOUND_COFFEE_PUBKEY],
      since: Math.floor(Date.now() / 1000) - 60 * 60 * 24, // look back 24h each run
    });

    for (const receipt of receipts) {
      try {
        const descriptionTag = receipt.tags.find((t) => t[0] === "description");
        if (!descriptionTag) continue;
        const zapRequest = JSON.parse(descriptionTag[1]);
        const amountTag = zapRequest.tags.find((t) => t[0] === "amount");
        if (!amountTag) continue;
        const amountSats = Math.floor(Number(amountTag[1]) / 1000);
        if (amountSats < MIN_BOOST_SATS) continue;

        await addMember(env, zapRequest.pubkey, "zap", {
          amountSats,
          receiptId: receipt.id,
        });
      } catch {
        // malformed receipt — skip it, not worth failing the whole run
      }
    }
  } finally {
    pool.close(DEFAULT_RELAYS);
  }
}

/** Checks pending orders for settlement via LUD-21 verify URLs, where available. */
async function pollPendingOrders(env) {
  const list = await env.SOUND_COFFEE_KV.list({ prefix: "order:" });

  for (const key of list.keys) {
    const raw = await env.SOUND_COFFEE_KV.get(key.name);
    if (!raw) continue;
    const order = JSON.parse(raw);
    if (order.status !== "pending" || !order.verifyUrl) continue;

    try {
      const res = await fetch(order.verifyUrl);
      const data = await res.json();
      if (data.settled) {
        order.status = "confirmed";
        await env.SOUND_COFFEE_KV.put(key.name, JSON.stringify(order));
        await addMember(env, order.buyerPubkey, "purchase", {
          orderId: order.orderId,
          amountSats: order.amountSats,
        });
      }
    } catch {
      // provider unreachable this run — try again next run
    }
  }
}

async function handleScheduled(env) {
  await pollZapBoosts(env);
  await pollPendingOrders(env);
}

// ---------------------------------------------------------------------

export default {
  fetch: handleFetch,
  scheduled: (event, env, ctx) => ctx.waitUntil(handleScheduled(env)),
};
